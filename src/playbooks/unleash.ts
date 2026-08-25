import { join } from "node:path";
import { chat } from "../brains/chat.js";
import { decideUnleashNasty } from "../brains/nasty.js";
import { LOOT_EXPLORE_STEPS } from "../brains/form-hunt.js";
import {
  clickWasNoop,
  formSubmitActions,
  rememberClick,
  mapBrain,
  unleashBrain,
  viewWidgetSig,
} from "../brains/unleash.js";
import { isFormCommitNote, isFormWorkNote, shouldStampMode } from "../brains/walker-mode.js";
import { decisionLines, type Brain } from "../brains/types.js";
import { parseLine } from "../schema/dsl.js";
import { bootRun } from "../executor/boot.js";
import { createExecutor } from "../executor/run.js";
import { withRun } from "../executor/session.js";
import { buildView } from "../executor/view.js";
import { shouldPersistFinding } from "../persist/finding.js";
import { writeLog } from "../persist/log.js";
import { loadMapPages, recordMode } from "../persist/fog.js";
import { jobFogTimes, jobOfBrain, modeFogKey, modeFogTimes, pageFogTimes } from "../schema/fog.js";
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
      ...(opts.configPath ? { configPath: opts.configPath } : {}),
    });

    let stepsUsed = 0;
    const clicksByPage = new Map<string, string[]>();
    const noopsByPage = new Map<string, string[]>();
    const formHits: Record<string, number> = {};
    const pageVisits: Record<string, number> = {};
    const pages = loadMapPages(opts.configPath);
    const job = jobOfBrain(brain.name);
    const pageFog: Record<string, string> = {
      ...(job ? jobFogTimes(pages, job) : pageFogTimes(pages)),
    };
    const modeFog: Record<string, string> = { ...modeFogTimes(pages) };
    let huntTarget: string | undefined;
    let lootSteps = 0;
    while (stepsUsed < steps) {
      const last = view.last
        ? { ok: view.last.ok, ...(view.last.finding ? { finding: view.last.finding } : {}) }
        : undefined;
      const onPage = view.page;
      const hereKey = `${view.page}/${view.surface}`;
      pageVisits[hereKey] = (pageVisits[hereKey] ?? 0) + 1;
      pageFog[view.page] = new Date().toISOString();
      const decision = await brain.decide({
        view,
        stepsUsed,
        last,
        pages: state.model.pages,
        writePolicy: state.config.writePolicy,
        recentClicks: clicksByPage.get(onPage) ?? [],
        noopIds: noopsByPage.get(onPage) ?? [],
        formHits,
        pageVisits,
        pageFog,
        modeFog,
        ...(job ? { job } : {}),
        ...(huntTarget ? { huntTarget } : {}),
        ...(lootSteps > 0 ? { lootSteps } : {}),
      });
      if (state.navMeta) {
        if (decision.mode) state.navMeta.mode = decision.mode;
        else delete state.navMeta.mode;
      }
      const formKey = `${view.page}/${view.surface}`;
      const filledForm = isFormWorkNote(decision.note);
      if (decision.huntTarget) huntTarget = decision.huntTarget;
      if (filledForm) huntTarget = undefined;
      let formOk = false;
      for (const line of decisionLines(decision)) {
        if (stepsUsed >= steps) break;
        const parsed = parseLine(line);
        const beforeClick =
          parsed && !("comment" in parsed) && parsed.kind === "click"
            ? { url: state.page.url(), sig: viewWidgetSig(view) }
            : undefined;
        const submitIds =
          parsed && !("comment" in parsed) && parsed.kind === "click"
            ? new Set(formSubmitActions(view.actions, view.surface, view).map((a) => a.id))
            : undefined;
        const result = await exec.runLine(line);
        view = result.view;
        stepsUsed += 1;
        if (parsed && !("comment" in parsed) && parsed.kind === "click") {
          clicksByPage.set(onPage, rememberClick(clicksByPage.get(onPage) ?? [], parsed.id));
          if (
            beforeClick &&
            result.ok &&
            !result.bounced &&
            !submitIds?.has(parsed.id) &&
            clickWasNoop(beforeClick, { url: state.page.url(), sig: viewWidgetSig(view) })
          ) {
            const dead = noopsByPage.get(onPage) ?? [];
            if (!dead.includes(parsed.id)) noopsByPage.set(onPage, [...dead, parsed.id]);
            if (decision.note === "form hunt") huntTarget = undefined;
          }
        }
        if (result.finding && shouldPersistFinding(result.finding.kind)) {
          findings.push(result.finding);
          view = await resetToSeed(exec, state, seedPageId);
          huntTarget = undefined;
          lootSteps = 0;
          formOk = false;
          break;
        }
        if (result.bounced || !result.ok) {
          if (result.bounced) view = await resetToSeed(exec, state, seedPageId);
          huntTarget = undefined;
          lootSteps = 0;
          formOk = false;
          break;
        }
        formOk = true;
      }
      if (formOk && shouldStampMode(decision) && decision.mode) {
        const at = new Date().toISOString();
        modeFog[modeFogKey(onPage, decision.mode)] = at;
        recordMode(state, onPage, decision.mode);
      }
      if (filledForm && formOk) formHits[formKey] = (formHits[formKey] ?? 0) + 1;
      if (isFormCommitNote(decision.note) && formOk && view.page !== onPage) {
        lootSteps = LOOT_EXPLORE_STEPS;
        huntTarget = undefined;
      } else if (lootSteps > 0) {
        lootSteps -= 1;
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
