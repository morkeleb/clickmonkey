import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chat, type ChatClient, type ChatMessage } from "../brains/chat.js";
import {
  createExploreBrain,
  defaultExploreSkills,
  DEFAULT_EXPLORE_CHARTER,
  ExploreError,
  checkExploreLine,
  completeCurrentPlanItem,
  draftExplorePlan,
  isNewProductFinding,
  recordPlanStep,
  formatViewForBrain,
  isBrainMissFinding,
  isScreenshotLine,
  isVisualCharter,
  probeExploreChat,
  type ExploreBrain,
} from "../brains/explore.js";
import type { Brain } from "../brains/types.js";
import { bootRun } from "../executor/boot.js";
import { formatLiveLine } from "../executor/nav-log.js";
import { createExecutor } from "../executor/run.js";
import { withRun } from "../executor/session.js";
import { buildView } from "../executor/view.js";
import { persistSharedMap } from "../persist/config.js";
import { appendEvent } from "../persist/events.js";
import { exploreOutlineOf, setPresenceOutline, stopPresence } from "../persist/presence.js";
import { pickSeedPageId, resetToSeed } from "./seed.js";
import { appendFindingReport } from "../persist/finding.js";
import { polishPageDescription } from "../surveyor/describe.js";
import { writeLog } from "../persist/log.js";
import type { Config } from "../schema/config.js";
import { formatExplorePlanItemLine, type UiExplorePlan } from "../schema/ui.js";
import { severityForKind, type Finding, type FindingSeverity } from "../schema/finding.js";
import type { Log } from "../schema/log.js";
import type { View } from "../schema/view.js";

export const EXPLORE_DEFAULT_STEPS = 30;
export const EXPLORE_DEFAULT_MINUTES = 20;
export { DEFAULT_EXPLORE_CHARTER, ExploreError };

export interface ExploreResult {
  ok: boolean;
  findings: Finding[];
  log: Log;
  logPath: string;
  sessionPath: string;
  stepsUsed: number;
}

const RUNTIME_KINDS = new Set(["pageError", "httpError", "notFound"]);

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

function listFindings(items: Finding[]): string {
  if (items.length === 0) return "(none)";
  return items.map((f) => `- ${f.id}: ${f.message}`).join("\n");
}

function writeSessionMd(opts: {
  path: string;
  startedAt: number;
  charter: string;
  config: Config;
  findings: Finding[];
  notes: string[];
  goods: string[];
  plan?: UiExplorePlan;
}): void {
  const bySev: Record<FindingSeverity, Finding[]> = {
    critical: [],
    major: [],
    minor: [],
    suggestion: [],
  };
  const runtime: Finding[] = [];
  for (const f of opts.findings) {
    const sev = f.severity ?? severityForKind(f.kind);
    bySev[sev].push(f);
    if (RUNTIME_KINDS.has(f.kind)) runtime.push(f);
  }
  const brain = opts.config.brain;
  const notes = opts.notes.length ? opts.notes.map((n) => `- ${n}`).join("\n") : "(none)";
  const goods = opts.goods.length ? opts.goods.map((n) => `- ${n}`).join("\n") : "(none)";
  const body = [
    `# Explore session — ${new Date(opts.startedAt).toISOString()} — ${opts.charter}`,
    "## Configuration",
    `- url: ${opts.config.url}`,
    `- model: ${brain?.model ?? ""}`,
    `- baseUrl: ${brain?.baseUrl ?? ""}`,
    "## Runtime errors",
    listFindings(runtime),
    "## Critical / Major / Minor / Suggestion",
    "### Critical",
    listFindings(bySev.critical),
    "### Major",
    listFindings(bySev.major),
    "### Minor",
    listFindings(bySev.minor),
    "### Suggestion",
    listFindings(bySev.suggestion),
    "## Plan",
    opts.plan
      ? [`${opts.plan.goal}`, ...opts.plan.items.map((it) => formatExplorePlanItemLine(it))].join("\n")
      : "(none)",
    "## Notes",
    notes,
    "## Positive observations",
    goods,
    "",
  ].join("\n");
  writeFileSync(opts.path, body, "utf8");
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
  const logPath = join(opts.outDir, "log.txt");
  const sessionPath = join(opts.outDir, "session.md");
  const invokeChat = opts.chat ?? chat;
  const boundChat = (input: { messages: ChatMessage[] }) =>
    invokeChat({
      baseUrl: brainCfg.baseUrl,
      model: brainCfg.model,
      apiKey,
      messages: input.messages,
    });
  await probeExploreChat({ chat: boundChat, baseUrl: brainCfg.baseUrl, model: brainCfg.model });
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
    const findings: Finding[] = [];
    const polished = new Set<string>();

    const snapshot = async (): Promise<View> =>
      buildView({
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

    await polishHere();
    let view = await snapshot();

    let plan: UiExplorePlan | undefined;
    if (!opts.brain) {
      plan = await draftExplorePlan({
        chat: boundChat,
        charter,
        skills: architecture,
        oracles,
        view,
        pages: state.model.pages,
        skip: state.config.skip,
        logRetry,
      });
      setPresenceOutline(opts.outDir, exploreOutlineOf({ charter, plan, now: plan.items.find((i) => i.status === "now")?.title }));
    }

    const refused = new Set<string>();
    const recentSteps: string[] = [];
    let consecutiveRefusals = 0;
    let itemSteps = 0;
    let stepsUsed = 0;
    while (stepsUsed < steps && Date.now() < deadline) {
      const last = view.last
        ? { ok: view.last.ok, ...(view.last.finding ? { finding: view.last.finding } : {}) }
        : undefined;
      const decision = await brain.decide({
        view,
        stepsUsed,
        last,
        charter,
        notes: notesOf(brain),
        recent: recentSteps,
        pages: state.model.pages,
        ...(plan ? { plan } : {}),
      });
      const line = decision.line.trim();
      const check = checkExploreLine(line, view, {
        stepsUsed,
        charter,
        rejected: [...refused],
        recent: recentSteps,
        pages: state.model.pages,
      });
      if (!check.ok) {
        consecutiveRefusals += 1;
        if (check.ban !== false) refused.add(line);
        logRetry(`explore refused: ${check.error}`);
        view = {
          ...view,
          last: { step: line, ok: false, ...(check.ban !== false ? { finding: "unknownId" } : {}) },
        };
        if (consecutiveRefusals >= 3) {
          throw new ExploreError(
            `explore refused ${JSON.stringify(line)} three times in a row (${check.error})`,
          );
        }
        continue;
      }
      consecutiveRefusals = 0;
      const currentItem = plan?.items.find((i) => i.status === "now");
      setPresenceOutline(
        opts.outDir,
        exploreOutlineOf({
          charter,
          now: [currentItem?.title, decision.note?.trim() || line].filter(Boolean).join(" — "),
          notes: notesOf(brain),
          plan,
        }),
      );
      if (
        isScreenshotLine(line) &&
        isScreenshotLine(view.last?.step ?? "") &&
        !isVisualCharter(charter)
      ) {
        throw new ExploreError(
          `explore will not take a screenshot when the last step was already a screenshot (${view.last?.step})`,
        );
      }
      const result = await exec.runLine(line);
      view = result.view;
      stepsUsed += 1;
      recentSteps.push(line);
      if (recentSteps.length > 12) recentSteps.shift();
      itemSteps += 1;
      const newProductFinding = isNewProductFinding({
        finding: result.finding,
        findingCreated: result.findingCreated,
        currentFindingIds: plan?.items.find((i) => i.status === "now")?.findingIds,
      });
      if (plan) {
        plan = recordPlanStep(
          plan,
          newProductFinding && result.finding ? { findingId: result.finding.id } : undefined,
        );
      }
      const itemFinished = Boolean(decision.done) || newProductFinding || itemSteps >= 10;
      if (plan && itemFinished) {
        plan = completeCurrentPlanItem(plan, decision.done || newProductFinding ? "done" : "skipped");
        itemSteps = 0;
      }
      if (plan) {
        const current = plan.items.find((i) => i.status === "now");
        setPresenceOutline(
          opts.outDir,
          exploreOutlineOf({
            charter,
            now: itemFinished
              ? current?.title || "plan complete"
              : [current?.title, decision.note?.trim() || line].filter(Boolean).join(" — "),
            notes: notesOf(brain),
            plan,
          }),
        );
      }
      if (result.finding && isBrainMissFinding(result.finding.kind)) {
        refused.add(line);
      } else if (newProductFinding && result.finding) {
        findings.push(result.finding);
        const extra = await explainFinding(boundChat, result.finding, view, charter);
        if (extra) appendFindingReport(opts.outDir, result.finding.id, extra);
        view = await resetToSeed(exec, state, seedPageId);
      } else if (result.finding) {
        view = await resetToSeed(exec, state, seedPageId);
      } else if (result.bounced) {
        view = await resetToSeed(exec, state, seedPageId);
      } else {
        await polishHere();
        view = await snapshot();
        if (view.last === undefined && result.view.last) view = { ...view, last: result.view.last };
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
    writeSessionMd({
      path: sessionPath,
      startedAt,
      charter,
      config: opts.config,
      findings,
      notes: notesOf(brain),
      goods: goodsOf(brain),
      plan,
    });

    return {
      ok: findings.length === 0,
      findings,
      log,
      logPath,
      sessionPath,
      stepsUsed,
    };
    });
  } finally {
    stopPresence(opts.outDir);
  }
}
