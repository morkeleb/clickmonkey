import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { persistSharedMap } from "../persist/config.js";
import { reportDocumentNotFound } from "../persist/broken.js";
import { loadMapPages, recordFog, shouldStampFog } from "../persist/fog.js";
import { pageFogTimes } from "../schema/fog.js";
import { startPresence, touchPresence } from "../persist/presence.js";
import { isNotFoundPage } from "../oracles/http.js";
import type { Config } from "../schema/config.js";
import type { Locator } from "../schema/locator.js";
import type { PageModel, PageModelDraft } from "../schema/page-model.js";
import { inspect } from "../surveyor/inspect.js";
import { recordPageLedgers } from "../surveyor/record.js";
import { originOfHref } from "../surveyor/ready.js";
import { attachNavLog, type NavMeta } from "./nav-log.js";
import { dumpVerboseState } from "./verbose.js";
import { buildView } from "./view.js";
import type { RunHandle } from "./session.js";
import { attachOracles, type RunState } from "./run.js";
import { locatorOf } from "../schema/locator.js";
import { readyKey, widgetKey } from "../schema/refs.js";

export function locatorsFromModel(model: PageModel | PageModelDraft): Record<string, Locator> {
  const out: Record<string, Locator> = {};
  for (const page of model.pages) {
    out[readyKey(page.id)] = { ...page.ready };
    for (const surface of page.surfaces) {
      for (const w of [...surface.fields, ...surface.actions]) {
        out[widgetKey(surface.id, w.id)] = locatorOf(w);
      }
    }
  }
  return out;
}

export function attachInspectAfterStep(state: RunState): void {
  state.afterStep = async (s) => {
    if (await isNotFoundPage(s.page)) {
      if (s.configPath) reportDocumentNotFound(s.configPath, s.page, s.outDir);
      return;
    }
    const r = await inspect(s.page, {
      model: s.model,
      lastAction: s.lastAction,
      appOrigin: originOfHref(s.config.url),
      inIntro: Boolean(s.inIntro),
    });
    s.model = r.model;
    s.pageId = r.pageId;
    s.surfaceStack = r.surfaceStack;
    if (s.configPath) {
      const saved = persistSharedMap(s.configPath, r.model);
      s.config = saved;
      s.model = saved.map;
      if (!s.replay) {
        await recordPageLedgers(s.configPath, s.page, r.testability, {
          appOrigin: originOfHref(s.config.url),
          seo: s.config.seo,
          path: s.model.pages.find((p) => p.id === s.pageId)?.path,
          outDir: s.outDir,
          html: s.stepHtml,
          skipQuality: Boolean(s.stepHtml),
        });
      }
    } else {
      s.config = { ...s.config, map: r.model };
    }
    if (s.outDir) touchPresence(s.outDir, s.pageId);
    if (shouldStampFog(s, false)) recordFog(s);
  };
}

export async function bootRun(
  handle: RunHandle,
  config: Config,
  outDir: string,
  opts?: {
    configPath?: string;
    replay?: boolean;
    usedLocators?: Record<string, Locator>;
    verbose?: boolean;
    brain?: string;
  },
): Promise<RunState> {
  mkdirSync(outDir, { recursive: true });
  const hintPageId =
    config.map.pages.find((p) => p.entry)?.id ?? config.map.pages[0]?.id ?? "boot";
  if (!opts?.replay) {
    startPresence(outDir, { pageId: hintPageId, brain: opts?.brain });
  }
  const navLogPath = join(outDir, "nav.jsonl");
  const navMeta: NavMeta = { phase: "boot" };
  const pendingFindings: RunState["pendingFindings"] = [];
  attachOracles({
    page: handle.page,
    pendingFindings,
    configPath: opts?.configPath,
    replay: opts?.replay,
    appOrigin: originOfHref(config.url),
    outDir,
  });
  await attachNavLog(handle.page, {
    path: navLogPath,
    echo: process.stderr,
    meta: navMeta,
  });
  await handle.page.goto(config.url, { waitUntil: "domcontentloaded" });
  const inspected = await inspect(handle.page, {
    model: config.map,
    appOrigin: originOfHref(config.url),
  });
  if (config.intro.length > 0) {
    const start = inspected.model.pages.find((p) => p.id === inspected.pageId);
    if (start && !start.entry) start.entry = true;
  }
  const usedLocators = { ...(opts?.usedLocators ?? {}) };
  navMeta.pageId = inspected.pageId;
  const state: RunState = {
    page: handle.page,
    context: handle.context,
    browser: handle.browser,
    config: { ...config, map: inspected.model },
    model: inspected.model,
    pageId: inspected.pageId,
    surfaceStack: inspected.surfaceStack,
    log: { schemaVersion: 1, steps: [], comments: [], usedLocators },
    usedLocators,
    pendingFindings,
    outDir,
    replay: opts?.replay,
    configPath: opts?.configPath,
    navMeta,
    navLogPath,
    verbose: Boolean(opts?.verbose),
    verboseSeq: 0,
    ...(opts?.brain ? { brain: opts.brain } : {}),
    ...(opts?.configPath ? { fogAtStart: pageFogTimes(loadMapPages(opts.configPath)) } : {}),
  };
  attachInspectAfterStep(state);
  if (!opts?.replay) touchPresence(outDir, state.pageId);
  const bootNotFound = await isNotFoundPage(handle.page);
  if (state.configPath && !bootNotFound) {
    const saved = persistSharedMap(state.configPath, inspected.model);
    state.config = saved;
    state.model = saved.map;
    if (shouldStampFog(state, bootNotFound)) recordFog(state);
    if (!state.replay) {
      await recordPageLedgers(state.configPath, handle.page, inspected.testability, {
        appOrigin: originOfHref(state.config.url),
        seo: state.config.seo,
        path: inspected.model.pages.find((p) => p.id === inspected.pageId)?.path,
        outDir: state.outDir,
      });
    }
  } else if (state.configPath) {
    reportDocumentNotFound(state.configPath, handle.page, state.outDir);
  }
  if (state.verbose) {
    const bootView = await buildView({
      page: state.page,
      pageId: state.pageId,
      surfaceStack: state.surfaceStack.length > 0 ? state.surfaceStack : [state.pageId],
      model: state.model,
      appUrl: state.config.url,
      fence: state.config.fence,
      intro: state.config.intro,
      skip: state.config.skip,
      inIntro: Boolean(state.inIntro),
      ...(state.configPath ? { configPath: state.configPath } : {}),
    });
    await dumpVerboseState(state, "boot", bootView);
  }
  return state;
}
