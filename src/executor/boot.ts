import { mkdirSync } from "node:fs";
import { persistSharedMap } from "../persist/config.js";
import { reportDocumentNotFound } from "../persist/broken.js";
import { isDocumentNotFound } from "../oracles/http.js";
import type { Config } from "../schema/config.js";
import type { Locator } from "../schema/locator.js";
import type { PageModel, PageModelDraft } from "../schema/page-model.js";
import { inspect } from "../surveyor/inspect.js";
import type { RunHandle } from "./session.js";
import type { RunState } from "./run.js";
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
    if (isDocumentNotFound(s.page)) {
      if (s.configPath) reportDocumentNotFound(s.configPath, s.page);
      return;
    }
    const r = await inspect(s.page, { model: s.model, lastAction: s.lastAction });
    s.model = r.model;
    s.pageId = r.pageId;
    s.surfaceStack = r.surfaceStack;
    if (s.configPath) {
      const saved = persistSharedMap(s.configPath, r.model);
      s.config = saved;
      s.model = saved.map;
    } else {
      s.config = { ...s.config, map: r.model };
    }
  };
}

export async function bootRun(
  handle: RunHandle,
  config: Config,
  outDir: string,
  opts?: { configPath?: string; replay?: boolean; usedLocators?: Record<string, Locator> },
): Promise<RunState> {
  mkdirSync(outDir, { recursive: true });
  await handle.page.goto(config.url, { waitUntil: "domcontentloaded" });
  const inspected = await inspect(handle.page, { model: config.map });
  const usedLocators = { ...(opts?.usedLocators ?? {}) };
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
    pendingFindings: [],
    outDir,
    replay: opts?.replay,
    configPath: opts?.configPath,
  };
  attachInspectAfterStep(state);
  if (state.configPath && !isDocumentNotFound(handle.page)) {
    const saved = persistSharedMap(state.configPath, inspected.model);
    state.config = saved;
    state.model = saved.map;
  } else if (state.configPath) {
    reportDocumentNotFound(state.configPath, handle.page);
  }
  return state;
}
