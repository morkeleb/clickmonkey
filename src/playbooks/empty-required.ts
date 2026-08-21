import { join } from "node:path";
import { bootRun } from "../executor/boot.js";
import { createExecutor, type RunState } from "../executor/run.js";
import { withRun } from "../executor/session.js";
import { isPotentialWrite } from "../executor/write-policy.js";
import { writeLog } from "../persist/log.js";
import { stopPresence } from "../persist/presence.js";
import type { Config } from "../schema/config.js";
import type { Finding } from "../schema/finding.js";
import type { Log, Step } from "../schema/log.js";
import type { Action, Page as PageDef, Surface } from "../schema/page-model.js";
import { compactLog } from "./compact.js";
import { pickSeedPageId } from "./seed.js";

export interface EmptyRequiredResult {
  ok: boolean;
  findings: Finding[];
  log: Log;
  logPath: string;
}

type Reachable = { surface: Surface; opener?: { surfaceId: string; id: string } };

function pageOf(state: RunState, pageId: string): PageDef | undefined {
  return state.model.pages.find((p) => p.id === pageId);
}

function pageSurface(page: PageDef): Surface | undefined {
  return page.surfaces.find((s) => s.kind === "page");
}

function pickSubmit(surface: Surface): Action | undefined {
  const ok = surface.actions.filter((a) => a.status === "ok");
  return ok.find((a) => isPotentialWrite(a)) ?? ok[0];
}

function reachableSurfaces(page: PageDef): Reachable[] {
  const seed = pageSurface(page);
  if (!seed) return [];
  const out: Reachable[] = [{ surface: seed }];
  const seen = new Set<string>([seed.id]);
  for (const surface of page.surfaces) {
    for (const action of surface.actions) {
      if (action.status !== "ok" || !action.opens || seen.has(action.opens)) continue;
      const dialog = page.surfaces.find((s) => s.id === action.opens);
      if (!dialog) continue;
      seen.add(dialog.id);
      out.push({ surface: dialog, opener: { surfaceId: surface.id, id: action.id } });
    }
  }
  return out;
}

function buildCases(page: PageDef): Step[][] {
  const cases: Step[][] = [];
  for (const { surface, opener } of reachableSurfaces(page)) {
    const submit = pickSubmit(surface);
    if (!submit) continue;
    for (const field of surface.fields) {
      if (!field.required || field.status !== "ok") continue;
      const steps: Step[] = [{ kind: "open", page: page.id }];
      if (opener) steps.push({ kind: "click", surface: opener.surfaceId, id: opener.id });
      steps.push({ kind: "fill", surface: surface.id, id: field.id, value: "" });
      steps.push({ kind: "click", surface: surface.id, id: submit.id });
      steps.push({ kind: "expectInvalid", surface: surface.id, id: field.id });
      cases.push(steps);
    }
  }
  return cases;
}

function caseLog(state: RunState, steps: Step[], finding?: Finding): Log {
  return {
    schemaVersion: 1,
    ...(finding
      ? { bug: finding.message, found: new Date().toISOString(), result: "failed" as const }
      : { result: "passed" as const }),
    comments: [],
    steps,
    usedLocators: { ...state.usedLocators },
  };
}

export async function runEmptyRequired(opts: {
  config: Config;
  configPath: string;
  outDir: string;
  headed?: boolean;
  timeout?: number;
  verbose?: boolean;
}): Promise<EmptyRequiredResult> {
  const logPath = join(opts.outDir, "replay.log");

  try {
    return await withRun({ headed: opts.headed, timeout: opts.timeout }, async (handle) => {
    const state = await bootRun(handle, opts.config, opts.outDir, {
      configPath: opts.configPath,
      verbose: opts.verbose,
      brain: "empty-required",
    });
    const exec = createExecutor(state);
    if (state.config.intro.length > 0) await exec.runIntro();

    const seedPageId = pickSeedPageId(state, state.pageId) ?? state.pageId;
    const findings: Finding[] = [];
    let replay: Log | undefined;

    const tried = new Set<string>();
    while (true) {
      const page = pageOf(state, seedPageId);
      const surface = page ? pageSurface(page) : undefined;
      const next = surface?.actions.find((a) => a.status === "ok" && !a.opens && !tried.has(a.id));
      if (!next || !surface) break;
      tried.add(next.id);
      const click = await exec.runStep({ kind: "click", surface: surface.id, id: next.id });
      if (click.finding) {
        findings.push(click.finding);
        replay ??= compactLog(caseLog(state, state.log.steps, click.finding));
      }
      const reset = await exec.runStep({ kind: "open", page: seedPageId });
      if (reset.finding) {
        findings.push(reset.finding);
        replay ??= compactLog(caseLog(state, state.log.steps, reset.finding));
      }
    }

    const seed = pageOf(state, seedPageId);
    const cases = seed ? buildCases(seed) : [];
    let lastPassed: Log | undefined;

    for (const steps of cases) {
      const start = state.log.steps.length;
      let finding: Finding | undefined;
      for (const step of steps) {
        const result = await exec.runStep(step);
        if (result.finding) {
          finding = result.finding;
          findings.push(result.finding);
          break;
        }
      }
      const ran = state.log.steps.slice(start);
      const tape = caseLog(state, ran, finding);
      if (finding) replay ??= tape;
      else lastPassed = tape;
    }

    if (!replay) {
      replay = lastPassed ?? {
        schemaVersion: 1,
        result: findings.length > 0 ? "failed" : "passed",
        comments: [],
        steps: state.log.steps,
        usedLocators: { ...state.usedLocators },
      };
    }

    if (findings.length > 0) replay.result = "failed";
    writeLog(logPath, replay);
    writeLog(join(opts.outDir, "log.txt"), {
      schemaVersion: 1,
      comments: [],
      steps: state.log.steps,
      usedLocators: { ...state.usedLocators },
      result: findings.length > 0 ? "failed" : "passed",
    });

    return {
      ok: findings.length === 0,
      findings,
      log: replay,
      logPath,
    };
    });
  } finally {
    stopPresence(opts.outDir);
  }
}
