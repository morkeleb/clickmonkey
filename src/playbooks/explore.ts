import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { chat, type ChatClient, type ChatMessage } from "../brains/chat.js";
import {
  createExploreBrain,
  defaultExploreSkills,
  DEFAULT_EXPLORE_CHARTER,
  formatViewForBrain,
  type ExploreBrain,
} from "../brains/explore.js";
import type { Brain } from "../brains/types.js";
import { bootRun } from "../executor/boot.js";
import { createExecutor, type RunState } from "../executor/run.js";
import { withRun } from "../executor/session.js";
import { buildView } from "../executor/view.js";
import { appendFindingReport } from "../persist/finding.js";
import { writeLog } from "../persist/log.js";
import type { Config } from "../schema/config.js";
import { severityForKind, type Finding, type FindingSeverity } from "../schema/finding.js";
import type { Log } from "../schema/log.js";
import type { View } from "../schema/view.js";

export const EXPLORE_DEFAULT_STEPS = 30;
export const EXPLORE_DEFAULT_MINUTES = 20;
export { DEFAULT_EXPLORE_CHARTER };

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
  if (!value) throw new Error(`${apiKeyEnv} is not set`);
  return value;
}

function requireBrain(config: Config): { baseUrl: string; model: string; apiKeyEnv?: string } {
  const brain = config.brain;
  if (!brain?.baseUrl || !brain.model) {
    throw new Error("explore requires config.brain.baseUrl and config.brain.model");
  }
  return brain;
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
    "## Notes",
    notes,
    "## Positive observations",
    "(none)",
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
}): Promise<ExploreResult> {
  const brainCfg = requireBrain(opts.config);
  const apiKey = resolveApiKey(brainCfg.apiKeyEnv);
  const steps = opts.steps ?? EXPLORE_DEFAULT_STEPS;
  const minutes = opts.minutes ?? EXPLORE_DEFAULT_MINUTES;
  const charter = opts.charter?.trim() || DEFAULT_EXPLORE_CHARTER;
  const skills = [defaultExploreSkills(), opts.skills?.trim()].filter(Boolean).join("\n\n");
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
  const brain = opts.brain ?? createExploreBrain({ chat: boundChat, charter, skills, startedAt, minutes });

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
    while (stepsUsed < steps && Date.now() < deadline) {
      const last = view.last
        ? { ok: view.last.ok, ...(view.last.finding ? { finding: view.last.finding } : {}) }
        : undefined;
      const decision = await brain.decide({ view, stepsUsed, last, charter, notes: notesOf(brain) });
      const result = await exec.runLine(decision.line);
      view = result.view;
      stepsUsed += 1;
      if (result.finding) {
        findings.push(result.finding);
        const extra = await explainFinding(boundChat, result.finding, view, charter);
        if (extra) appendFindingReport(opts.outDir, result.finding.id, extra);
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
    writeSessionMd({
      path: sessionPath,
      startedAt,
      charter,
      config: opts.config,
      findings,
      notes: notesOf(brain),
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
}
