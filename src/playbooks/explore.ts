import { chat, type ChatClient, type ChatMessage } from "../brains/chat.js";
import {
  createExploreBrain,
  defaultExploreSkills,
  DEFAULT_EXPLORE_CHARTER,
  ExploreError,
  draftExplorePlan,
  formatViewForBrain,
  probeExploreChat,
  type ExploreBrain,
} from "../brains/explore.js";
import type { Brain } from "../brains/types.js";
import { bootRun } from "../executor/boot.js";
import { formatLiveLine } from "../executor/nav-log.js";
import { createExecutor } from "../executor/run.js";
import { withRun } from "../executor/session.js";
import { persistSharedMap } from "../persist/config.js";
import { loadMapPages } from "../persist/fog.js";
import { modeFogKey, modeFogTimes } from "../schema/fog.js";
import { lineMatchesMode } from "../brains/walker-mode.js";
import { appendEvent } from "../persist/events.js";
import { exploreOutlineOf, setPresenceOutline, stopPresence } from "../persist/presence.js";
import { pickSeedPageId } from "./seed.js";
import { appendFindingReport } from "../persist/finding.js";
import { polishPageDescription } from "../surveyor/describe.js";
import { requireVisionShots, resolveVision, type Config } from "../schema/config.js";
import type { Finding } from "../schema/finding.js";
import type { View } from "../schema/view.js";
import { probeVisionChat } from "../surveyor/vision.js";
import {
  ExploreSession,
  type ExploreResult,
} from "./explore-session.js";

export const EXPLORE_DEFAULT_STEPS = 30;
export const EXPLORE_DEFAULT_MINUTES = 20;
export { DEFAULT_EXPLORE_CHARTER, ExploreError };
export type { ExploreResult };
export {
  ExploreSession,
  applyExploreStep,
  createExploreWalk,
  exploreVisitOf,
  snapshotView,
  withPriorLast,
  writeSessionMd,
  EXPLORE_REPORT_PROMPT,
  type ExploreStepResult,
  type ExploreStepOpts,
  type ExploreWalkCtx,
  type ExploreWalkOpts,
} from "./explore-session.js";

function resolveApiKey(apiKeyEnv: string | undefined): string | undefined {
  if (!apiKeyEnv) return undefined;
  const value = process.env[apiKeyEnv];
  if (!value) {
    throw new ExploreError(
      `explore needs the API key in ${apiKeyEnv}, but that environment variable is not set`,
    );
  }
  return value;
}

function requireBrain(config: Config): { baseUrl: string; model: string; apiKeyEnv?: string } {
  const brain = config.brain;
  if (!brain?.baseUrl || !brain.model) {
    throw new ExploreError("explore requires config.brain.baseUrl and config.brain.model");
  }
  return brain;
}

async function explainFinding(
  boundChat: (input: { messages: ChatMessage[] }) => Promise<string>,
  finding: Finding,
  view: View,
  charter: string,
): Promise<string | undefined> {
  try {
    const text = await boundChat({
      messages: [
        {
          role: "user",
          content: [
            "A finding was recorded during exploratory testing.",
            `Charter: ${charter}`,
            `Kind: ${finding.kind}`,
            `Message: ${finding.message}`,
            "Current view:",
            formatViewForBrain(view),
            "",
            "Write a short markdown section covering:",
            "1. What happened",
            "2. Why it matters",
            "3. How to retest",
          ].join("\n"),
        },
      ],
    });
    const extra = text.trim();
    return extra || undefined;
  } catch {
    return undefined;
  }
}

function notesOf(brain: Brain): string[] {
  return "getNotes" in brain && typeof (brain as ExploreBrain).getNotes === "function"
    ? (brain as ExploreBrain).getNotes()
    : [];
}

function goodsOf(brain: Brain): string[] {
  return "getGoods" in brain && typeof (brain as ExploreBrain).getGoods === "function"
    ? (brain as ExploreBrain).getGoods()
    : [];
}

export async function runExplore(opts: {
  config: Config;
  configPath: string;
  outDir: string;
  headed?: boolean;
  timeout?: number;
  steps?: number;
  minutes?: number;
  charter?: string;
  skills?: string;
  chat?: ChatClient;
  brain?: Brain;
  verbose?: boolean;
}): Promise<ExploreResult> {
  const brainCfg = requireBrain(opts.config);
  const apiKey = resolveApiKey(brainCfg.apiKeyEnv);
  const steps = opts.steps ?? EXPLORE_DEFAULT_STEPS;
  const minutes = opts.minutes ?? EXPLORE_DEFAULT_MINUTES;
  const charter = opts.charter?.trim() || DEFAULT_EXPLORE_CHARTER;
  const oracles = defaultExploreSkills();
  const architecture = opts.skills?.trim() ?? "";
  const startedAt = Date.now();
  const deadline = startedAt + minutes * 60_000;
  const invokeChat = opts.chat ?? chat;
  const boundChat = (input: { messages: ChatMessage[] }) =>
    invokeChat({
      baseUrl: brainCfg.baseUrl,
      model: brainCfg.model,
      apiKey,
      messages: input.messages,
    });
  await probeExploreChat({ chat: boundChat, baseUrl: brainCfg.baseUrl, model: brainCfg.model });
  let vision;
  try {
    requireVisionShots(opts.config);
    vision = resolveVision(opts.config.vision, opts.config.brain);
  } catch (err) {
    throw new ExploreError(err instanceof Error ? err.message : String(err));
  }
  if (vision && (vision.issues || vision.assist)) {
    const visionKey = resolveApiKey(vision.apiKeyEnv);
    try {
      await probeVisionChat({
        chat: invokeChat,
        baseUrl: vision.baseUrl,
        model: vision.model,
        apiKey: visionKey,
      });
    } catch (err) {
      throw err instanceof ExploreError ? err : new ExploreError(err instanceof Error ? err.message : String(err));
    }
  }
  const retrySink: { path?: string } = {};
  const logRetry = (message: string): void => {
    process.stderr.write(`${formatLiveLine(message)}\n`);
    if (retrySink.path) {
      appendEvent(retrySink.path, { ts: new Date().toISOString(), type: "brain", message });
    }
  };
  const brain =
    opts.brain ??
    createExploreBrain({
      chat: boundChat,
      charter,
      skills: architecture,
      oracles,
      startedAt,
      minutes,
      skip: opts.config.skip,
      logRetry,
    });

  try {
    return await withRun({ headed: opts.headed, timeout: opts.timeout }, async (handle) => {
    const state = await bootRun(handle, opts.config, opts.outDir, {
      configPath: opts.configPath,
      verbose: opts.verbose,
      brain: brain.name,
    });
    const exec = createExecutor(state);
    retrySink.path = state.navLogPath;
    setPresenceOutline(opts.outDir, exploreOutlineOf({ charter }));
    if (state.config.intro.length > 0) await exec.runIntro();

    const seedPageId = pickSeedPageId(state, state.pageId) ?? state.pageId;
    const polished = new Set<string>();

    const polishHere = async (): Promise<void> => {
      const page = state.model.pages.find((p) => p.id === state.pageId);
      if (!page?.description || !page.describeKey) return;
      const token = `${page.id}:${page.describeKey}`;
      if (polished.has(token)) return;
      polished.add(token);
      if (await polishPageDescription(page, boundChat)) {
        if (state.configPath) {
          const saved = persistSharedMap(state.configPath, state.model);
          state.config = saved;
          state.model = saved.map;
        }
      }
    };

    const session = ExploreSession.attach({
      state,
      exec,
      charter,
      startedAt,
      seedPageId,
      config: opts.config,
      configPath: opts.configPath,
      outDir: opts.outDir,
      polish: polishHere,
      onAfterStep: async ({ result, view, newProductFinding }) => {
        if (newProductFinding && result.finding) {
          const extra = await explainFinding(boundChat, result.finding, view, charter);
          if (extra) appendFindingReport(opts.outDir, result.finding.id, extra);
        }
      },
    });

    await polishHere();
    let view = await session.snapshot();

    if (!opts.brain) {
      session.setPlan(
        await draftExplorePlan({
          chat: boundChat,
          charter,
          skills: architecture,
          oracles,
          view,
          pages: state.model.pages,
          skip: state.config.skip,
          logRetry,
        }),
      );
    }

    let consecutiveRefusals = 0;
    let itemSteps = 0;
    const modeFog: Record<string, string> = { ...modeFogTimes(loadMapPages(opts.configPath)) };
    while (session.stepsUsed < steps && Date.now() < deadline) {
      const last = view.last
        ? { ok: view.last.ok, ...(view.last.finding ? { finding: view.last.finding } : {}) }
        : undefined;
      const onPage = view.page;
      const decision = await brain.decide({
        view,
        stepsUsed: session.stepsUsed,
        last,
        charter,
        notes: notesOf(brain),
        recent: session.recent,
        pages: state.model.pages,
        sight: state.lastSight,
        modeFog,
        ...(session.plan ? { plan: session.plan } : {}),
      });
      const line = decision.line.trim();
      const stepped = await session.step(line, {
        note: decision.note,
        good: decision.good,
        done: decision.done,
      });
      if (!stepped.ok) {
        consecutiveRefusals += 1;
        logRetry(`explore refused: ${stepped.error}`);
        view = stepped.visit.view;
        if (consecutiveRefusals >= 3) {
          throw new ExploreError(
            `explore refused ${JSON.stringify(line)} three times in a row (${stepped.error})`,
          );
        }
        continue;
      }
      consecutiveRefusals = 0;
      if (
        decision.mode &&
        decision.mode !== "nav" &&
        lineMatchesMode(line, decision.mode, view, state.model.pages)
      ) {
        modeFog[modeFogKey(onPage, decision.mode)] = new Date().toISOString();
      }
      view = stepped.visit.view;
      itemSteps += 1;
      const itemFinished = Boolean(decision.done) || stepped.newProductFinding || itemSteps >= 10;
      if (session.plan && itemFinished) {
        if (!decision.done) {
          session.advancePlan(stepped.newProductFinding ? "done" : "skipped");
        }
        itemSteps = 0;
      }
    }

    return session.finish({ notes: notesOf(brain), goods: goodsOf(brain) });
    });
  } finally {
    stopPresence(opts.outDir);
  }
}
