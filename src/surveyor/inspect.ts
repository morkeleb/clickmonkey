import type { Page } from "playwright";
import { locatorOf } from "../schema/locator.js";
import { PageModel, type PageModelDraft } from "../schema/page-model.js";
import { toPlaywrightLocator } from "../executor/locators.js";
import { isNotFoundPage } from "../oracles/http.js";
import { reportDocumentNotFound } from "../persist/broken.js";
import { loadConfig, persistSharedMap } from "../persist/config.js";
import {
  dedupeIssues,
  isInsufficient,
  type TestabilityIssue,
} from "../schema/testability.js";
import { recordPageLedgers } from "./record.js";
import { auditVisible } from "./audit.js";
import { collectCandidates } from "./collect.js";
import { foldPathTemplates, identityKey, mergePageModel } from "./merge.js";
import {
  createPageFromUrl,
  findPageForHref,
  originOfHref,
} from "./ready.js";
import { resolveCount } from "./resolve.js";
import { applyMissingPageDescriptions } from "./describe.js";
import { bindSurfaces, foldActiveTabChrome } from "./surfaces.js";

export interface SurveyorContext {
  model: PageModel | PageModelDraft;
  lastAction?: { surface: string; id: string; opens?: string; fromPage?: string };
  /** Origin of the leash `url`. Off-leash pages get `page.origin`. */
  appOrigin?: string;
  /** Pages first seen during intro are entry pages, not hop targets. */
  inIntro?: boolean;
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
  stamped: boolean;
}> {
  const appOrigin = ctx.appOrigin ?? originOfHref(page.url());
  const entry = Boolean(ctx.inIntro);
  if (ctx.model.pages.length === 0) {
    const url = new URL(page.url());
    const created = await createPageFromUrl(page, new Set(), appOrigin, { entry });
    return {
      model: {
        schemaVersion: 1,
        app: url.hostname || ctx.model.app || "app",
        generation: ctx.model.generation,
        pages: [created],
      },
      createdPage: true,
      stamped: false,
    };
  }

  const model = PageModel.parse(structuredClone(ctx.model));
  model.pages = foldPathTemplates(model.pages);
  const existing = appOrigin
    ? findPageForHref(model.pages, page.url(), appOrigin)
    : undefined;
  if (existing) {
    let stamped = false;
    const live = originOfHref(page.url());
    if (appOrigin && live && live !== appOrigin && !existing.origin) {
      existing.origin = live;
      stamped = true;
    }
    if (entry && !existing.entry) {
      existing.entry = true;
      stamped = true;
    }
    return { model, createdPage: false, stamped };
  }
  const used = new Set(model.pages.map((p) => p.id));
  model.pages.push(await createPageFromUrl(page, used, appOrigin, { entry }));
  return { model, createdPage: true, stamped: false };
}

export async function inspect(page: Page, ctx: SurveyorContext): Promise<InspectResult> {
  if (await isNotFoundPage(page)) {
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

  let { model, createdPage, stamped } = await modelForPage(page, ctx);
  const appOrigin = ctx.appOrigin ?? originOfHref(page.url());
  const modelPage = appOrigin
    ? findPageForHref(model.pages, page.url(), appOrigin)
    : undefined;
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
      c.resolves = (await resolveCount(root, locatorOf(c))).count >= 1;
    }

    const current = model.pages.find((p) => p.id === pageId);
    const surface = current?.surfaces.find((s) => s.id === entry.surfaceId);
    const leftoverResolves: Record<string, boolean> = {};
    if (surface) {
      const candKeys = new Set(
        candidates.map((c) => identityKey(entry.surfaceId, c.by, c.value, c.name, c.nth)),
      );
      for (const w of [...surface.fields, ...surface.actions]) {
        const key = identityKey(entry.surfaceId, w.by, w.value, w.name, w.nth);
        if (candKeys.has(key)) continue;
        leftoverResolves[key] = (await resolveCount(root, locatorOf(w))).count >= 1;
      }
    }

    const isCurrentDialog =
      entry.kind === "dialog" && entry.surfaceId === bound.stack[bound.stack.length - 1];
    const lastOpensHint = (() => {
      if (!ctx.lastAction) return undefined;
      if (isCurrentDialog) {
        if (ctx.lastAction.surface === entry.surfaceId) return undefined;
        return {
          actionId: ctx.lastAction.id,
          actionSurfaceId: ctx.lastAction.surface,
          opens: ctx.lastAction.opens ?? entry.surfaceId,
        };
      }
      const fromPage = ctx.lastAction.fromPage;
      if (fromPage && fromPage !== pageId) {
        return {
          actionId: ctx.lastAction.id,
          actionSurfaceId: ctx.lastAction.surface,
          opens: pageId,
          fromPage,
        };
      }
      return undefined;
    })();

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

  const current = model.pages.find((p) => p.id === pageId);
  if (current && foldActiveTabChrome(current)) merged = true;

  const parsed = PageModel.parse(model);
  const title = (await page.title().catch(() => "")).trim();
  const heading = (await page.locator("h1").first().innerText({ timeout: 500 }).catch(() => "")).trim();
  if (
    applyMissingPageDescriptions(parsed.pages, {
      currentId: pageId,
      chrome: {
        ...(title ? { title } : {}),
        ...(heading ? { heading } : {}),
      },
    })
  ) {
    merged = true;
  }
  const issues = dedupeIssues(auditIssues);
  return {
    model: parsed,
    pageId,
    currentSurface: bound.stack[bound.stack.length - 1] ?? bound.pageSurfaceId,
    surfaceStack: bound.stack,
    candidatesFound,
    merged: merged || stamped || parsed.generation !== startGen,
    testability: { insufficient: isInsufficient(issues), issues },
  };
}

export async function inspectAndSaveConfig(
  page: Page,
  configPath: string,
): Promise<InspectResult> {
  const config = loadConfig(configPath);
  const result = await inspect(page, {
    model: config.map,
    appOrigin: originOfHref(config.url),
  });
  if (await isNotFoundPage(page)) {
    reportDocumentNotFound(configPath, page);
    return result;
  }
  await recordPageLedgers(configPath, page, result.testability, {
    appOrigin: originOfHref(config.url),
    seo: config.seo,
    path: result.model.pages.find((p) => p.id === result.pageId)?.path,
  });
  const saved = persistSharedMap(configPath, result.model);
  return { ...result, model: saved.map };
}
