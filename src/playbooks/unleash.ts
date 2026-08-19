import { join } from "node:path";
import { chat } from "../brains/chat.js";
import { decideUnleashNasty } from "../brains/nasty.js";
import { rememberClick, mapBrain, unleashBrain } from "../brains/unleash.js";
import { decisionLines, type Brain } from "../brains/types.js";
import { parseLine } from "../schema/dsl.js";
import { bootRun } from "../executor/boot.js";
import { createExecutor } from "../executor/run.js";
import { withRun } from "../executor/session.js";
import { buildView } from "../executor/view.js";
import { shouldPersistFinding } from "../persist/finding.js";
import { writeLog } from "../persist/log.js";
import { stopPresence } from "../persist/presence.js";
import { requireVisionShots, resolveVision, VisionError, type Config } from "../schema/config.js";
import type { Finding } from "../schema/finding.js";
import type { Log } from "../schema/log.js";
import { probeVisionChat } from "../surveyor/vision.js";
import { pickSeedPageId, resetToSeed } from "./seed.js";

export const UNLEASH_DEFAULT_STEPS = 50;
export const UNLEASH_CLI_STEPS = 200;
export const MAP_CLI_STEPS = 200;

export type UnleashMode = "navigate" | "mutate";

export interface UnleashResult {
  ok: boolean;
  findings: Finding[];
  log: Log;
  logPath: string;
  stepsUsed: number;
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
  mode?: UnleashMode;
  verbose?: boolean;
}): Promise<UnleashResult> {
  const steps = opts.steps ?? UNLEASH_DEFAULT_STEPS;
  const mode = opts.mode ?? "mutate";
  const brain =
    opts.brain ??
    (mode === "navigate"
      ? mapBrain
      : opts.nasty
        ? { name: "unleash-nasty", decide: (ctx) => decideUnleashNasty(ctx) }
        : unleashBrain);
  const logPath = join(opts.outDir, "log.txt");
  requireVisionShots(opts.config);
  const vision = resolveVision(opts.config.vision, opts.config.brain);
  if (vision?.issues) {
    let apiKey: string | undefined;
    if (vision.apiKeyEnv) {
      apiKey = process.env[vision.apiKeyEnv];
      if (!apiKey) {
        throw new VisionError(
          `vision needs the API key in ${vision.apiKeyEnv}, but that environment variable is not set`,
        );
      }
    }
    await probeVisionChat({
      chat,
      baseUrl: vision.baseUrl,
      model: vision.model,
      apiKey,
    });
  }

  try {
    return await withRun({ headed: opts.headed, timeout: opts.timeout }, async (handle) => {
    const state = await bootRun(handle, opts.config, opts.outDir, {
      configPath: opts.configPath,
      verbose: opts.verbose,
      brain: brain.name,
    });
    const exec = createExecutor(state);
    if (state.config.intro.length > 0) await exec.runIntro();

    const seedPageId = pickSeedPageId(state, state.pageId) ?? state.pageId;
    const findings: Finding[] = [];

    let view = await buildView({
      page: state.page,
      pageId: state.pageId,
      surfaceStack: state.surfaceStack.length > 0 ? state.surfaceStack : [state.pageId],
      model: state.model,
      appUrl: state.config.url,
      fence: state.config.fence,
      intro: state.config.intro,
      skip: state.config.skip,
      inIntro: Boolean(state.inIntro),
    });

    let stepsUsed = 0;
    const clicksByPage = new Map<string, string[]>();
    while (stepsUsed < steps) {
      const last = view.last
        ? { ok: view.last.ok, ...(view.last.finding ? { finding: view.last.finding } : {}) }
        : undefined;
      const onPage = view.page;
      const decision = await brain.decide({
        view,
        stepsUsed,
        last,
        pages: state.model.pages,
        writePolicy: state.config.writePolicy,
        recentClicks: clicksByPage.get(onPage) ?? [],
      });
      for (const line of decisionLines(decision)) {
        if (stepsUsed >= steps) break;
        const result = await exec.runLine(line);
        view = result.view;
        stepsUsed += 1;
        const parsed = parseLine(line);
        if (parsed && !("comment" in parsed) && parsed.kind === "click") {
          clicksByPage.set(onPage, rememberClick(clicksByPage.get(onPage) ?? [], parsed.id));
        }
        if (result.finding && shouldPersistFinding(result.finding.kind)) {
          findings.push(result.finding);
          view = await resetToSeed(exec, state, seedPageId);
          break;
        }
        if (result.bounced || !result.ok) {
          if (result.bounced) view = await resetToSeed(exec, state, seedPageId);
          break;
        }
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
  } finally {
    stopPresence(opts.outDir);
  }
}
