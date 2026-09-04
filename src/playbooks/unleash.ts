import { join } from "node:path";
import { chat } from "../brains/chat.js";
import { decideUnleashNasty } from "../brains/nasty.js";
import { LOOT_EXPLORE_STEPS, parseFormLock } from "../brains/form-hunt.js";
import { formatLiveLine } from "../executor/nav-log.js";
import {
  clickWasNoop,
  continueFormBurst,
  FORM_COMMIT_RETRIES,
  formSubmitActions,
  isPrimaryFormCommit,
  rememberClick,
  mapBrain,
  unleashBrain,
  viewWidgetSig,
} from "../brains/unleash.js";
import { isFormCommitNote, isFormWorkNote, shouldStampMode } from "../brains/walker-mode.js";
import { decisionLines, skipInspectForBurstLine, type Brain } from "../brains/types.js";
import { parseLine } from "../schema/dsl.js";
import { bootRun } from "../executor/boot.js";
import { createExecutor } from "../executor/run.js";
import { withRun } from "../executor/session.js";
import { buildView } from "../executor/view.js";
import { isSilentSubmitMessage } from "../executor/field-validity.js";
import { shouldPersistFinding } from "../persist/finding.js";
import { writeLog } from "../persist/log.js";
import { loadMapPages, recordFormWork, recordMode } from "../persist/fog.js";
import {
  formWorkTimes,
  jobFogTimes,
  jobOfBrain,
  mergeLaterClocks,
  modeFogKey,
  modeFogTimes,
  pageFogTimes,
} from "../schema/fog.js";
import { stopPresence } from "../persist/presence.js";
import { requireVisionShots, resolveVision, VisionError, type Config } from "../schema/config.js";
import type { Finding } from "../schema/finding.js";
import type { Log } from "../schema/log.js";
import { probeVisionChat } from "../surveyor/vision.js";
import { recoverLeashIfNeeded, liveHref, viewOfState } from "./leash.js";
import { pickSeedPageId, resetToSeed } from "./seed.js";

export const UNLEASH_DEFAULT_STEPS = 50;
export const UNLEASH_CLI_STEPS = 200;
export const UNLEASH_FORM_STEPS = 40;
export const MAP_CLI_STEPS = 200;

export class FormLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormLockError";
  }
}

export type UnleashMode = "navigate" | "mutate";

export interface UnleashResult {
  ok: boolean;
  findings: Finding[];
  log: Log;
  logPath: string;
  stepsUsed: number;
  /** `--form` page. Set when the walk was pinned to one create form. */
  lockForm?: string;
  /** Submit left the locked form. */
  submitted?: { from: string; to: string };
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
  /** Map page id (`clients_new`) — hunt there, fill, submit, stop when the page changes. */
  form?: string;
  echo?: { write(chunk: string): unknown };
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
  const config = opts.form ? { ...opts.config, vision: undefined } : opts.config;
  requireVisionShots(config);
  const vision = resolveVision(config.vision, config.brain);
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
    const state = await bootRun(handle, config, opts.outDir, {
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
    const formSpent: Record<string, true> = {};
    const fillTried: Record<string, true> = {};
    let fillTriedKey = "";
    const pageVisits: Record<string, number> = {};
    const pages = loadMapPages(opts.configPath);
    const job = jobOfBrain(brain.name);
    const pageFog: Record<string, string> = {
      ...(job ? jobFogTimes(pages, job) : pageFogTimes(pages)),
    };
    const formWork: Record<string, string> = { ...(job ? formWorkTimes(pages, job) : {}) };
    const modeFog: Record<string, string> = { ...modeFogTimes(pages) };
    const lockForm = opts.form ? parseFormLock(opts.form).pageId : undefined;
    if (lockForm && !state.model.pages.some((p) => p.id === lockForm)) {
      throw new FormLockError(`unknown --form ${opts.form} (not a map page)`);
    }
    if (lockForm) {
      opts.echo?.write(`${formatLiveLine(`form-loop lock ${lockForm}`)}\n`);
    }
    let huntTarget: string | undefined = lockForm ? `${lockForm}/page` : undefined;
    let lootSteps = 0;
    let submitted: UnleashResult["submitted"];
    let stayedSaves = 0;
    const leash = { tries: 0 };
    const echoLeash = (line: string): void => {
      const formatted = `${formatLiveLine(line)}\n`;
      process.stderr.write(formatted);
      opts.echo?.write(formatted);
    };
    while (stepsUsed < steps) {
      const rec = await recoverLeashIfNeeded({
        pageId: view.page,
        href: liveHref(state),
        pages: state.model.pages,
        exec,
        state,
        budget: leash,
        echo: echoLeash,
      });
      if (rec.attempted || rec.gaveUp) {
        view = await viewOfState(state);
      }
      if (rec.gaveUp) break;
      if (rec.recovered || rec.attempted) continue;
      const last = view.last
        ? { ok: view.last.ok, ...(view.last.finding ? { finding: view.last.finding } : {}) }
        : undefined;
      const onPage = view.page;
      const urlAtStart = state.page.url();
      const hereKey = `${view.page}/${view.surface}`;
      if (hereKey !== fillTriedKey) {
        for (const id of Object.keys(fillTried)) delete fillTried[id];
        fillTriedKey = hereKey;
      }
      if (opts.configPath) {
        const disk = loadMapPages(opts.configPath);
        if (job) {
          mergeLaterClocks(pageFog, jobFogTimes(disk, job));
          mergeLaterClocks(formWork, formWorkTimes(disk, job));
        } else {
          mergeLaterClocks(pageFog, pageFogTimes(disk));
        }
        mergeLaterClocks(modeFog, modeFogTimes(disk));
      }
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
        formSpent,
        fillTried,
        pageVisits,
        pageFog,
        formWork,
        modeFog,
        ...(job ? { job } : {}),
        ...(huntTarget ? { huntTarget } : {}),
        ...(lootSteps > 0 ? { lootSteps } : {}),
        ...(lockForm ? { lockForm } : {}),
      });
      if (state.navMeta) {
        if (decision.mode) state.navMeta.mode = decision.mode;
        else delete state.navMeta.mode;
      }
      const formKey = `${view.page}/${view.surface}`;
      const filledForm = isFormWorkNote(decision.note);
      if (decision.huntTarget) huntTarget = decision.huntTarget;
      if (filledForm && !lockForm) huntTarget = undefined;
      let formOk = false;
      let saveLine: string | undefined;
      let urlBeforeSave: string | undefined;
      const burst = decisionLines(decision);
      for (let i = 0; i < burst.length; i++) {
        if (stepsUsed >= steps) break;
        const line = burst[i]!;
        const parsed = parseLine(line);
        const beforeClick =
          parsed && !("comment" in parsed) && parsed.kind === "click"
            ? { url: state.page.url(), sig: viewWidgetSig(view) }
            : undefined;
        const submitIds =
          parsed && !("comment" in parsed) && parsed.kind === "click"
            ? new Set(formSubmitActions(view.actions, view.surface, view).map((a) => a.id))
            : undefined;
        if (
          parsed &&
          !("comment" in parsed) &&
          parsed.kind === "click" &&
          isPrimaryFormCommit(parsed) &&
          view.page !== onPage
        ) {
          break;
        }
        const result = await exec.runLine(line, {
          skipInspect: skipInspectForBurstLine(i, burst.length),
        });
        view = result.view;
        stepsUsed += 1;
        if (parsed && !("comment" in parsed) && parsed.kind === "fill") {
          fillTried[parsed.id] = true;
        }
        if (parsed && !("comment" in parsed) && parsed.kind === "click") {
          clicksByPage.set(onPage, rememberClick(clicksByPage.get(onPage) ?? [], parsed.id));
          if (isPrimaryFormCommit(parsed) && (submitIds?.has(parsed.id) || Boolean(lockForm))) {
            saveLine = line;
            urlBeforeSave = beforeClick?.url ?? urlAtStart;
          }
          if (
            beforeClick &&
            result.ok &&
            !result.bounced &&
            !submitIds?.has(parsed.id) &&
            clickWasNoop(beforeClick, { url: state.page.url(), sig: viewWidgetSig(view) })
          ) {
            const dead = noopsByPage.get(onPage) ?? [];
            if (!dead.includes(parsed.id)) noopsByPage.set(onPage, [...dead, parsed.id]);
            if (decision.note === "form hunt" && !lockForm) huntTarget = undefined;
          }
        }
        const lineKind = parsed && !("comment" in parsed) ? parsed.kind : undefined;
        const keepGoing = continueFormBurst(lineKind, {
          ok: result.ok,
          ...(result.bounced ? { bounced: true } : {}),
          ...(result.finding ? { findingKind: result.finding.kind } : {}),
        });
        if (result.finding && shouldPersistFinding(result.finding.kind)) {
          findings.push(result.finding);
          if (!keepGoing) {
            const crash = result.finding.kind === "pageError";
            if (!lockForm || crash) {
              view = await resetToSeed(exec, state, seedPageId);
              huntTarget = lockForm ? `${lockForm}/page` : undefined;
              lootSteps = 0;
            }
            formOk = false;
            break;
          }
        }
        if (!keepGoing && (result.bounced || !result.ok)) {
          if (result.bounced || !lockForm) {
            if (result.bounced) view = await resetToSeed(exec, state, seedPageId);
            huntTarget = lockForm ? `${lockForm}/page` : undefined;
            lootSteps = 0;
          }
          formOk = false;
          break;
        }
        if (result.ok) formOk = true;
        if (parsed && !("comment" in parsed) && parsed.kind === "fill" && view.page !== onPage) {
          break;
        }
      }
      if (formOk && shouldStampMode(decision) && decision.mode) {
        const at = new Date().toISOString();
        modeFog[modeFogKey(onPage, decision.mode)] = at;
        recordMode(state, onPage, decision.mode);
      }
      if (!lockForm && saveLine) {
        if (formOk) {
          formHits[formKey] = (formHits[formKey] ?? 0) + 1;
          formSpent[formKey] = true;
          huntTarget = undefined;
          stayedSaves = 0;
          const worked = parseFormLock(formKey);
          recordFormWork(state, worked.pageId, worked.surfaceId);
          formWork[formKey] = new Date().toISOString();
        } else {
          stayedSaves += 1;
          if (stayedSaves > FORM_COMMIT_RETRIES) {
            formHits[formKey] = (formHits[formKey] ?? 0) + 1;
            formSpent[formKey] = true;
            huntTarget = undefined;
            stayedSaves = 0;
          }
        }
      }
      const urlNow = state.page.url();
      const leftForm =
        Boolean(lockForm && saveLine) &&
        (view.page !== onPage || Boolean(urlBeforeSave && urlNow !== urlBeforeSave));
      if (leftForm) {
        submitted = { from: onPage, to: view.page };
        opts.echo?.write(
          `${formatLiveLine(`form-loop submitted ${onPage} → ${view.page} (${urlNow})`)}\n`,
        );
        break;
      }
      if (lockForm && saveLine && !leftForm) {
        stayedSaves += 1;
        const silent = findings.some((f) => isSilentSubmitMessage(f.message));
        const why = silent
          ? "silentSubmit"
          : (view.last?.finding ?? (view.last?.ok === false ? "failed" : "stayed"));
        opts.echo?.write(`${formatLiveLine(`form-loop still ${lockForm} after ${saveLine} (${why})`)}\n`);
        if (silent || stayedSaves > FORM_COMMIT_RETRIES) {
          opts.echo?.write(
            `${formatLiveLine(
              silent
                ? `form-loop silentSubmit on ${lockForm}`
                : `form-loop gave up after ${stayedSaves} Saves still on ${lockForm}`,
            )}\n`,
          );
          break;
        }
      }
      if (isFormCommitNote(decision.note) && formOk && view.page !== onPage) {
        if (lockForm) {
          submitted = { from: onPage, to: view.page };
          opts.echo?.write(`${formatLiveLine(`form-loop submitted ${onPage} → ${view.page}`)}\n`);
          break;
        }
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

    if (lockForm && !submitted) {
      opts.echo?.write(`${formatLiveLine(`form-loop stopped on ${view.page} after ${stepsUsed} steps`)}\n`);
    }

    return {
      ok: lockForm ? Boolean(submitted) : findings.length === 0,
      findings,
      log,
      logPath,
      stepsUsed,
      ...(lockForm ? { lockForm } : {}),
      ...(submitted ? { submitted } : {}),
    };
    });
  } finally {
    stopPresence(opts.outDir);
  }
}
