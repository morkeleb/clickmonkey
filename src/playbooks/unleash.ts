import { join } from "node:path";
import { decideUnleashNasty } from "../brains/nasty.js";
import { unleashBrain } from "../brains/unleash.js";
import type { Brain } from "../brains/types.js";
import { bootRun } from "../executor/boot.js";
import { createExecutor, type RunState } from "../executor/run.js";
import { withRun } from "../executor/session.js";
import { buildView } from "../executor/view.js";
import { writeLog } from "../persist/log.js";
import type { Config } from "../schema/config.js";
import type { Finding } from "../schema/finding.js";
import type { Log } from "../schema/log.js";
import type { View } from "../schema/view.js";

export const UNLEASH_DEFAULT_STEPS = 50;
export const UNLEASH_CLI_STEPS = 200;

export interface UnleashResult {
  ok: boolean;
  findings: Finding[];
  log: Log;
  logPath: string;
  stepsUsed: number;
}

async function resetToSeed(
  exec: ReturnType<typeof createExecutor>,
  state: RunState,
  seedPageId: string,
): Promise<View> {
  if (state.model.pages.some((p) => p.id === seedPageId)) {
    const reset = await exec.runLine(`open ${seedPageId}`);
    return reset.view;
  }
  await state.page.goto(state.config.url, { waitUntil: "domcontentloaded" });
  return buildView({
    page: state.page,
    pageId: state.pageId,
    surfaceStack: state.surfaceStack.length > 0 ? state.surfaceStack : [state.pageId],
    model: state.model,
  });
}

export async function runUnleash(opts: {
  config: Config;
  configPath: string;
  outDir: string;
  headed?: boolean;
  timeout?: number;
  steps?: number;
  brain?: Brain;
  nasty?: boolean;
}): Promise<UnleashResult> {
  const steps = opts.steps ?? UNLEASH_DEFAULT_STEPS;
  const brain =
    opts.brain ??
    (opts.nasty
      ? { name: "unleash-nasty", decide: (ctx) => decideUnleashNasty(ctx) }
      : unleashBrain);
  const logPath = join(opts.outDir, "log.txt");

  return withRun({ headed: opts.headed, timeout: opts.timeout }, async (handle) => {
    const state = await bootRun(handle, opts.config, opts.outDir, { configPath: opts.configPath });
    const exec = createExecutor(state);
    if (state.config.intro.length > 0) await exec.runIntro();

    const seedPageId = state.pageId;
    const findings: Finding[] = [];

    let view = await buildView({
      page: state.page,
      pageId: state.pageId,
      surfaceStack: state.surfaceStack.length > 0 ? state.surfaceStack : [state.pageId],
      model: state.model,
    });

    let stepsUsed = 0;
    while (stepsUsed < steps) {
      const last = view.last
        ? { ok: view.last.ok, ...(view.last.finding ? { finding: view.last.finding } : {}) }
        : undefined;
      const decision = await brain.decide({ view, stepsUsed, last });
      const result = await exec.runLine(decision.line);
      view = result.view;
      stepsUsed += 1;
      if (result.finding) {
        findings.push(result.finding);
        view = await resetToSeed(exec, state, seedPageId);
      }
    }

    const log: Log = {
      schemaVersion: 1,
      comments: [],
      steps: state.log.steps,
      usedLocators: { ...state.usedLocators },
      result: findings.length > 0 ? "failed" : "passed",
    };
    writeLog(logPath, log);

    return {
      ok: findings.length === 0,
      findings,
      log,
      logPath,
      stepsUsed,
    };
  });
}
