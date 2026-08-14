import type { Page } from "playwright";
import { locatorOf } from "../schema/locator.js";
import { PageModel, type PageModelDraft } from "../schema/page-model.js";
import { toPlaywrightLocator } from "../executor/locators.js";
import { isDocumentNotFound } from "../oracles/http.js";
import { reportDocumentNotFound } from "../persist/broken.js";
import { loadConfig, persistSharedMap } from "../persist/config.js";
import {
  dedupeIssues,
  isInsufficient,
  type TestabilityIssue,
} from "../schema/testability.js";
import { persistTestabilityPage } from "../persist/testability.js";
import { auditVisible } from "./audit.js";
import { collectCandidates } from "./collect.js";
import { identityKey, mergePageModel } from "./merge.js";
import { createPageFromUrl, pathMatches, pathnameOf } from "./ready.js";
import { resolveCount } from "./resolve.js";
import { bindSurfaces } from "./surfaces.js";

export interface SurveyorContext {
  model: PageModel | PageModelDraft;
  lastAction?: { surface: string; id: string; opens?: string };
}

export interface InspectResult {
  model: PageModel | PageModelDraft;
  pageId: string;
  currentSurface: string;
  surfaceStack: string[];
  candidatesFound: number;
  merged: boolean;
  testability: { insufficient: boolean; issues: TestabilityIssue[] };
}

async function modelForPage(page: Page, ctx: SurveyorContext): Promise<{
  model: PageModel;
  createdPage: boolean;
}> {
  if (ctx.model.pages.length === 0) {
    const url = new URL(page.url());
    const created = await createPageFromUrl(page, new Set());
    return {
      model: {
        schemaVersion: 1,
        app: url.hostname || ctx.model.app || "app",
        generation: ctx.model.generation,
        pages: [created],
      },
      createdPage: true,
    };
  }

  const model = PageModel.parse(structuredClone(ctx.model));
  const pathname = pathnameOf(page);
  if (model.pages.some((p) => pathMatches(p.path, pathname))) {
    return { model, createdPage: false };
  }
  const used = new Set(model.pages.map((p) => p.id));
  model.pages.push(await createPageFromUrl(page, used));
  return { model, createdPage: true };
}

export async function inspect(page: Page, ctx: SurveyorContext): Promise<InspectResult> {
  if (isDocumentNotFound(page)) {
    const fallback = ctx.model.pages[0];
    return {
      model: ctx.model,
      pageId: fallback?.id ?? "home",
      currentSurface: fallback?.surfaces.find((s) => s.kind === "page")?.id ?? "page",
      surfaceStack: [fallback?.surfaces.find((s) => s.kind === "page")?.id ?? "page"],
      candidatesFound: 0,
      merged: false,
      testability: { insufficient: false, issues: [] },
    };
  }

  let { model, createdPage } = await modelForPage(page, ctx);
  const pathname = pathnameOf(page);
  const modelPage = model.pages.find((p) => pathMatches(p.path, pathname));
  if (!modelPage) throw new Error("internal: page missing after create");
  const pageId = modelPage.id;

  const bound = await bindSurfaces(page, modelPage, ctx.lastAction);
  const startGen = model.generation;
  let candidatesFound = 0;
  let merged = createdPage;
  const auditIssues: TestabilityIssue[] = [];

  for (const entry of bound.entries) {
    const root = entry.locator ? toPlaywrightLocator(page, entry.locator) : page;
    const audit = await auditVisible(page, root, {
      excludeVisibleDialogs: entry.kind === "page",
      checkMain: entry.kind === "page",
    });
    auditIssues.push(...audit.issues);
    const candidates = await collectCandidates(root, {
      excludeVisibleDialogs: entry.kind === "page",
    });
    candidatesFound += candidates.length;

    for (const c of candidates) {
      c.resolves = (await resolveCount(root, locatorOf(c))).count === 1;
    }

    const current = model.pages.find((p) => p.id === pageId);
    const surface = current?.surfaces.find((s) => s.id === entry.surfaceId);
    const leftoverResolves: Record<string, boolean> = {};
    if (surface) {
      const candKeys = new Set(
        candidates.map((c) => identityKey(entry.surfaceId, c.by, c.value, c.name)),
      );
      for (const w of [...surface.fields, ...surface.actions]) {
        const key = identityKey(entry.surfaceId, w.by, w.value, w.name);
        if (candKeys.has(key)) continue;
        leftoverResolves[key] = (await resolveCount(root, locatorOf(w))).count === 1;
      }
    }

    const isCurrentDialog =
      entry.kind === "dialog" && entry.surfaceId === bound.stack[bound.stack.length - 1];
    const lastOpensHint =
      ctx.lastAction && isCurrentDialog
        ? {
            actionId: ctx.lastAction.id,
            actionSurfaceId: ctx.lastAction.surface,
            opens: ctx.lastAction.opens ?? entry.surfaceId,
          }
        : undefined;

    const result = mergePageModel(model, {
      pageId,
      surfaceId: entry.surfaceId,
      surfaceKind: entry.kind,
      surfaceLocator: entry.locator,
      candidates,
      leftoverResolves,
      lastOpensHint,
    });
    model = result.model;
    if (result.appended.length > 0 || result.createdSurface) merged = true;
  }

  const parsed = PageModel.parse(model);
  const issues = dedupeIssues(auditIssues);
  return {
    model: parsed,
    pageId,
    currentSurface: bound.stack[bound.stack.length - 1] ?? bound.pageSurfaceId,
    surfaceStack: bound.stack,
    candidatesFound,
    merged: merged || parsed.generation !== startGen,
    testability: { insufficient: isInsufficient(issues), issues },
  };
}

export async function inspectAndSaveConfig(
  page: Page,
  configPath: string,
): Promise<InspectResult> {
  const config = loadConfig(configPath);
  const result = await inspect(page, { model: config.map });
  if (isDocumentNotFound(page)) {
    reportDocumentNotFound(configPath, page);
    return result;
  }
  persistTestabilityPage(configPath, {
    path: pathnameOf(page),
    foundAt: new Date().toISOString(),
    insufficient: result.testability.insufficient,
    issues: result.testability.issues,
  });
  const saved = persistSharedMap(configPath, result.model);
  return { ...result, model: saved.map };
}
