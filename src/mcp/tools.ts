import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { defaultExploreSkills, EXPLORE_PLAN_SYSTEM, parseExplorePlanReply } from "../brains/explore.js";
import { listCatalogs, pickNastyFill, SAMPLE_MAX_CHARS, samplePayloads } from "../brains/nasty.js";
import { resolveConfigPath, resolveOutDir } from "../cli/common.js";
import { reclaimMcpPresence } from "../persist/presence.js";
import { configWithMap, loadConfig, saveConfig } from "../persist/config.js";
import { loadQualityReport, qualityReportPath } from "../persist/quality.js";
import { readLog } from "../persist/log.js";
import { collectFindingCases } from "../persist/runs.js";
import { loadTestabilityReport, testabilityReportPath } from "../persist/testability.js";
import { mapPath, runsDir } from "../persist/workspace.js";
import {
  ExploreSession,
  EXPLORE_REPORT_PROMPT,
  type ExploreResult,
  type ExploreStepOpts,
  type ExploreStepResult,
} from "../playbooks/explore-session.js";
import {
  checkSpecFile,
  defaultSpecSkills,
  formatCheckReport,
  formatSpecTable,
  listSpecFiles,
  runSpecs,
  writeSpecMarkdown,
  type SpecRunResult,
} from "../playbooks/spec.js";
import { renderQualityDigest, writeRunsReport } from "../reports/findings-report.js";
import type { Config } from "../schema/config.js";
import { emptyConfig, requirePageModel } from "../schema/config.js";
import { formatStep } from "../schema/dsl.js";
import type { Finding, FindingSeverity } from "../schema/finding.js";
import type { Log } from "../schema/log.js";
import type { Page } from "../schema/page-model.js";
import { formatExplorePlanItemLine, type UiExploreOutline, type UiExplorePlan } from "../schema/ui.js";
import type { View } from "../schema/view.js";
import type { ExploreVisit } from "../schema/visit.js";
import { ledgerOrigin, originOfHref } from "../surveyor/ready.js";
import { sameLedgerPage } from "../schema/testability.js";

export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string };

export type McpToolResult = {
  content: McpContent[];
  isError?: boolean;
};

export type McpSession = Pick<
  ExploreSession,
  | "start"
  | "visit"
  | "pageState"
  | "step"
  | "setPlan"
  | "advancePlan"
  | "addNote"
  | "addGood"
  | "finish"
  | "abort"
  | "tape"
> & {
  started?: boolean;
  outDir?: string;
  configPath?: string;
  config?: Config;
  lastScreenshotPath?: string;
  pages?: readonly Page[];
  livePageUrl?: string;
  currentView?: View;
  plan?: UiExplorePlan;
  charter?: string;
  skills?: string;
  notes?: readonly string[];
  goods?: readonly string[];
  findings?: readonly Finding[];
};

/** Compacted walk MCP can freeze after explore_finish (or a log you pass). */
export type McpLastWalk = {
  log: Log;
  logPath: string;
  configPath: string;
  intro?: readonly string[];
};

export type McpHost = {
  configFlag?: string;
  session?: McpSession;
  createSession?: () => McpSession;
  /** True after this process wrote a findings report for the current session. */
  reported?: boolean;
  pendingReport?: {
    configPath: string;
    config: Config;
    outDir: string;
    summary?: string;
    extra?: string;
    outlines?: Array<{ runId: string; outline: UiExploreOutline }>;
  };
  /** Last finished MCP walk; spec_save uses this when no live tape is worth freezing. */
  lastWalk?: McpLastWalk;
  /** Test seam; defaults to playbook runSpecs (live browser). */
  runSpecs?: (opts: Parameters<typeof runSpecs>[0]) => Promise<SpecRunResult>;
  /** Map file loaded for this process (`explore_start` `map`). */
  mapPath?: string;
};

const HOST_TEXT_MAX = 8000;
const FINDING_SEVERITIES = new Set<FindingSeverity>(["major", "minor", "suggestion"]);

function clipHostText(text: string | undefined): string | undefined {
  const one = text?.trim();
  if (!one) return undefined;
  if (one.length <= HOST_TEXT_MAX) return one;
  return `${one.slice(0, HOST_TEXT_MAX - 1)}…`;
}

const PROMPT_NAMES = "prompts: clickmonkey, explore_tester, explore_plan, explore_report, spec_writer";

/** Product menu for MCP hosts. Keep short — not a second README. */
export const CLICKMONKEY_GUIDE = [
  "# ClickMonkey",
  "",
  "Five monkeys (working names): map, unleash, nasty, explore, mcp.",
  "Spec and typed tests are run modes (letters s/t) and do not stamp job clocks.",
  "The host LLM walks via MCP, then freezes the tape as a spec and proves replay.",
  "`clickmonkey explore` is unattended (needs brain). mcp is the host walk. Map, unleash, and nasty stay CLI.",
  "Read clickmonkey://map for the sitemap. This text is also prompt `clickmonkey`.",
  "",
  "## Monkeys",
  "",
  "- **map** — CLI `clickmonkey map`. Unseen doors, then unvisited (and later stale) pages. Never fills or submits.",
  "- **unleash** — CLI `clickmonkey unleash`. Pathfinds to mapped forms, fills, submits. On the tile: wizard (Next, no hop), or the least-recent of form / list / tab / dialog / empty, else nav.",
  "- **nasty** — CLI `clickmonkey nasty` (same as `unleash --nasty`). Same hunt on the nasty fog clock: junk + missed validation, on a site you own.",
  "- **explore** — CLI `clickmonkey explore` (needs brain). Charter-driven, unattended. Same Mode: as unleash. Skills: prompts explore_tester, explore_plan, explore_report.",
  "- **mcp** — host LLM walks (`explore_start` … `explore_finish`), then spec_save / spec_run. Same Mode. Not `clickmonkey explore`.",
  "",
  "## Spec and replay (not monkeys)",
  "",
  "- **Spec** — MCP `spec_save` writes the compacted walk to `clickmonkey/specs/*.md`. Skill: prompt spec_writer (clickmonkey://spec). `spec_check` is ids-only. `spec_run` (and CLI `clickmonkey spec`) live-replays. That freeze+replay is why MCP exists besides explore.",
  "- **Replay** — CLI `clickmonkey replay`. Comparison vs a findings report, not a spec.",
  "",
  "## Leash",
  "",
  "- Create with `explore_init` or `clickmonkey init --url …` (clickmonkey.json + clickmonkey/).",
  "- Fence (stay on-app) and intro (login) live in the leash, not in specs.",
  "- Commit clickmonkey.json, clickmonkey/map.json, clickmonkey/specs/, clickmonkey/explore-context.md.",
  "- Ignore clickmonkey/runs/, replays/, reports/, bundle/.",
  "",
  "## MCP loop",
  "",
  "explore_start (charter, optional map= path to map.json) → explore_set_plan from sitemap cards → explore_step / nasty_fill → explore_note / explore_good / explore_finding → explore_finish with summary.",
  "explore_visit is the compact token-saving snapshot (default). Pass full=true for every mapped widget including disabled Save.",
  "Read prompt spec_writer before freezing. Then spec_save (title) → spec_check → spec_run. Do not invent widget ids. Map, unleash, and nasty stay CLI.",
].join("\n");

const NASTY_WARNING =
  "For a site you own (your staging). Do not point it at anyone else's production.";

export function createMcpHost(opts?: { config?: string }): McpHost {
  return { ...(opts?.config ? { configFlag: opts.config } : {}) };
}

function textResult(text: string, isError = false): McpToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function configPathOf(host: McpHost, override?: string): string {
  return resolveConfigPath(override ?? host.configFlag);
}

function ensureSession(host: McpHost): McpSession {
  if (!host.session) host.session = host.createSession?.() ?? new ExploreSession();
  return host.session;
}

function liveSession(host: McpHost): McpSession | undefined {
  const session = host.session;
  if (!session?.started) return undefined;
  return session;
}

function requireLive(host: McpHost): McpSession | McpToolResult {
  const session = liveSession(host);
  if (!session) return textResult("explore session is not started", true);
  return session;
}

function isToolResult(value: McpSession | McpToolResult): value is McpToolResult {
  return "content" in value;
}

function runIdOf(session: McpSession): string {
  return session.outDir ? basename(session.outDir) : "";
}

const VISIT_SIGHT_MAX = 200;

function clipLine(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
}

function formatVisitText(visit: ExploreVisit, session?: McpSession): string {
  const runId = session ? runIdOf(session) : "";
  const ready = visit.ready ? JSON.stringify(visit.ready) : "";
  const sight = visit.sight ? clipLine(visit.sight, VISIT_SIGHT_MAX) : undefined;
  const header = [
    runId ? `run: ${runId}` : undefined,
    ready ? `ready: ${ready}` : undefined,
    `legalOpen: ${visit.legalOpen.join(", ") || "(none)"}`,
    visit.shot ? `shot: ${visit.shot}` : undefined,
    visit.planLine ? `planLine: ${visit.planLine}` : undefined,
    sight ? `sight: ${sight}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
  return `${header}\n\n${visit.formatted}`;
}

const THIN_MAP_PAGES = 2;

function startExtras(visit: ExploreVisit, pageCount: number): string {
  const lines = [
    `Legal open ids: ${visit.legalOpen.join(", ") || "(none)"}`,
    "sitemap: clickmonkey://map",
    "guide: clickmonkey://guide",
    "spec: clickmonkey://spec",
    PROMPT_NAMES,
  ];
  if (pageCount < THIN_MAP_PAGES) {
    const noun = pageCount === 1 ? "page" : "pages";
    lines.push(
      `map is thin (${pageCount} ${noun}). Run \`clickmonkey map\` (CLI) to grow it before exploring.`,
    );
  }
  return lines.join("\n");
}

function pngContent(path: string): McpContent {
  return { type: "image", mimeType: "image/png", data: readFileSync(path).toString("base64") };
}

/** Run-dir only. Absolute paths and `..` outside `outDir` are rejected. */
export function resolveShot(session: McpSession, given?: string): string | undefined {
  const candidate = given ?? session.lastScreenshotPath;
  if (!candidate) return undefined;
  const root = session.outDir;
  if (!root) return given ? undefined : candidate;
  const resolved = isAbsolute(candidate) ? candidate : resolve(root, candidate);
  const rel = relative(root, resolved);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return resolved;
}

export async function handleExploreInit(
  host: McpHost,
  args: { url: string; config?: string },
): Promise<McpToolResult> {
  const path = configPathOf(host, args.config);
  if (existsSync(path)) return textResult(`monkey settings already exists: ${path}`);
  try {
    saveConfig(path, emptyConfig(args.url));
  } catch (err) {
    return textResult(errText(err), true);
  }
  return textResult(path);
}

export async function handleExploreStart(
  host: McpHost,
  args: { charter?: string; skills?: string; headed?: boolean; config?: string; map?: string },
): Promise<McpToolResult> {
  const configPath = configPathOf(host, args.config);
  if (!existsSync(configPath)) {
    return textResult(
      `config not found: ${configPath}. Run \`clickmonkey init --url …\` or \`explore_init\` first.`,
      true,
    );
  }
  let config: Config;
  try {
    config = loadConfig(configPath);
    if (args.map) {
      config = configWithMap(config, args.map, configPath);
      host.mapPath = isAbsolute(args.map) ? args.map : resolve(dirname(configPath), args.map);
    } else {
      host.mapPath = mapPath(configPath);
    }
  } catch (err) {
    return textResult(errText(err), true);
  }
  const outDir = resolveOutDir(undefined, configPath);
  mkdirSync(outDir, { recursive: true });
  reclaimMcpPresence(runsDir(configPath), { pid: process.pid });
  const session = ensureSession(host);
  try {
    const visit = await session.start({
      config,
      configPath,
      outDir,
      headed: args.headed,
      charter: args.charter,
      skills: args.skills,
      brainName: "mcp",
    });
    host.reported = false;
    host.pendingReport = undefined;
    const mapNote = args.map ? `map: ${host.mapPath}` : undefined;
    const extras = [startExtras(visit, config.map.pages.length), mapNote].filter(Boolean).join("\n");
    return textResult(`${formatVisitText(visit, session)}\n\n${extras}`);
  } catch (err) {
    if (session.started) {
      try {
        await session.finish();
      } catch {
        // start already failed; still drop a zombie ctx
      }
    }
    return textResult(errText(err), true);
  }
}

export async function handleExploreStep(
  host: McpHost,
  args: { line: string; note?: string; good?: string; done?: boolean },
): Promise<McpToolResult> {
  const session = requireLive(host);
  if (isToolResult(session)) return session;
  const opts: ExploreStepOpts = {
    ...(args.note ? { note: args.note } : {}),
    ...(args.good ? { good: args.good } : {}),
    ...(args.done ? { done: true } : {}),
  };
  let result: ExploreStepResult;
  try {
    result = await session.step(args.line, opts);
  } catch (err) {
    return textResult(errText(err), true);
  }
  const text = formatVisitText(result.visit, session);
  if (!result.ok) return textResult(`${result.error}\n\n${text}`, true);
  return textResult(text);
}

export async function handleExploreVisit(
  host: McpHost,
  args?: { full?: boolean },
): Promise<McpToolResult> {
  const session = requireLive(host);
  if (isToolResult(session)) return session;
  try {
    if (args?.full) {
      const dump = await session.pageState();
      const runId = runIdOf(session);
      const header = [
        runId ? `run: ${runId}` : undefined,
        session.livePageUrl ? `url: ${session.livePageUrl}` : undefined,
        "detail: full (mapped widgets, including disabled)",
      ]
        .filter(Boolean)
        .join("\n");
      return textResult(`${header}\n\n${dump}`);
    }
    const visit = await session.visit();
    return textResult(formatVisitText(visit, session));
  } catch (err) {
    return textResult(errText(err), true);
  }
}

export async function handleExploreShot(
  host: McpHost,
  args: { path?: string },
): Promise<McpToolResult> {
  const session = requireLive(host);
  if (isToolResult(session)) return session;
  const path = resolveShot(session, args.path);
  if (args.path && !path) {
    return textResult("shot path is outside the run directory", true);
  }
  if (!path || !existsSync(path)) {
    return textResult("no screenshot yet; run explore_step with screenshot or wait for a step shot", true);
  }
  return {
    content: [{ type: "text", text: path }, pngContent(path)],
  };
}

export async function handleExploreSetPlan(
  host: McpHost,
  args: { goal: string; items: Array<{ title: string; page?: string }> },
): Promise<McpToolResult> {
  const session = requireLive(host);
  if (isToolResult(session)) return session;
  const legal = (session.pages ?? []).map((p) => p.id);
  const plan = parseExplorePlanReply(JSON.stringify(args), legal);
  if (!plan) return textResult("could not parse plan; need goal and 2–6 items", true);
  session.setPlan(plan);
  return textResult(`goal: ${plan.goal}\nitems: ${plan.items.length}`);
}

export async function handleExploreAdvance(
  host: McpHost,
  args: { status: "done" | "skipped" },
): Promise<McpToolResult> {
  const session = requireLive(host);
  if (isToolResult(session)) return session;
  session.advancePlan(args.status);
  const now = session.plan?.items.find((i) => i.status === "now");
  return textResult(now ? `now: ${now.title}` : "plan complete");
}

export async function handleExploreNote(host: McpHost, args: { text: string }): Promise<McpToolResult> {
  const session = requireLive(host);
  if (isToolResult(session)) return session;
  session.addNote(args.text);
  return textResult("ok");
}

export async function handleExploreGood(host: McpHost, args: { text: string }): Promise<McpToolResult> {
  const session = requireLive(host);
  if (isToolResult(session)) return session;
  session.addGood(args.text);
  return textResult("ok");
}

export async function handleExploreQuality(host: McpHost): Promise<McpToolResult> {
  const session = requireLive(host);
  if (isToolResult(session)) return session;
  const configPath = session.configPath ?? configPathOf(host);
  const href = session.livePageUrl;
  if (!href) return textResult("no current page");
  let path: string;
  try {
    path = new URL(href).pathname || "/";
    if (path === "") path = "/";
  } catch {
    return textResult(`cannot parse page url: ${href}`, true);
  }
  const origin = ledgerOrigin(href, originOfHref(session.config?.url ?? ""));
  const key = { path, ...(origin ? { origin } : {}) };
  const quality = loadQualityReport(qualityReportPath(configPath, session.outDir));
  const testability = loadTestabilityReport(testabilityReportPath(configPath, session.outDir));
  const lines = renderQualityDigest(
    { schemaVersion: 1, pages: testability.pages.filter((p) => sameLedgerPage(p, key)) },
    { schemaVersion: 1, pages: quality.pages.filter((p) => sameLedgerPage(p, key)) },
  );
  return textResult(lines.join("\n") || `no quality ledger for ${path}`);
}

export async function handleExploreFindings(host: McpHost): Promise<McpToolResult> {
  const session = requireLive(host);
  if (isToolResult(session)) return session;
  return textResult(formatFindingsList(session.outDir));
}

function formatFindingsList(outDir: string | undefined): string {
  if (!outDir) return "(none)";
  const cases = collectFindingCases([outDir]);
  if (cases.length === 0) return "(none)";
  return cases
    .map((c) => {
      const path = pathOfHref(c.url ?? c.finding.url) ?? c.pageId ?? "";
      const shot = c.screenshotPath
        ? relative(outDir, c.screenshotPath).split("\\").join("/")
        : "(none)";
      const msg = clipLine(c.finding.message, 160);
      return `${c.finding.id}\t${c.finding.kind}\t${c.severity}\t${path || "(none)"}\t${shot}\t${msg}`;
    })
    .join("\n");
}

function pathOfHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const path = new URL(href).pathname;
    return path === "" ? "/" : path;
  } catch {
    return undefined;
  }
}

export async function handleExploreFinding(
  host: McpHost,
  args: { message: string; severity?: string },
): Promise<McpToolResult> {
  const session = requireLive(host);
  if (isToolResult(session)) return session;
  const message = args.message.trim();
  if (!message) return textResult("message is required", true);
  const severityRaw = args.severity?.trim();
  const severity =
    severityRaw && FINDING_SEVERITIES.has(severityRaw as FindingSeverity)
      ? (severityRaw as FindingSeverity)
      : "major";
  if (severityRaw && severityRaw !== severity) {
    return textResult("severity must be major, minor, or suggestion", true);
  }
  const line = formatStep({ kind: "screenshot", ui: true, label: message });
  let stepped: ExploreStepResult;
  try {
    stepped = await session.step(line, { hostFinding: true, severity });
  } catch (err) {
    return textResult(errText(err), true);
  }
  const visitText = formatVisitText(stepped.visit, session);
  if (!stepped.ok) return textResult(`${stepped.error}\n\n${visitText}`, true);
  const id = stepped.result.finding?.id ?? "(none)";
  return textResult(`finding: ${id}\n${visitText}`);
}

async function flushPendingReport(host: McpHost): Promise<McpToolResult> {
  const pending = host.pendingReport;
  if (!pending) return textResult("explore session is not started", true);
  try {
    const written = await writeRunsReport({
      configPath: pending.configPath,
      config: pending.config,
      runDirs: [pending.outDir],
      ...(pending.summary ? { summary: pending.summary } : {}),
      ...(pending.extra ? { extra: pending.extra } : {}),
      ...(pending.outlines ? { outlines: pending.outlines } : {}),
      onBrainError: (message) => console.error(`brain skipped: ${message}`),
    });
    host.reported = true;
    host.pendingReport = undefined;
    return textResult(`report: ${written.mdPath}`);
  } catch (err) {
    return textResult(errText(err), true);
  }
}

/** Finish a live session. No-op (ok) when nothing is started — used on MCP disconnect. */
export async function finishExplore(
  host: McpHost,
  args: { report?: boolean; summary?: string; extra?: string } = {},
): Promise<McpToolResult> {
  const session = liveSession(host);
  if (!session) {
    if (args.report !== false && host.pendingReport) return flushPendingReport(host);
    return textResult("explore session is not started");
  }
  const configPath = session.configPath ?? configPathOf(host);
  const outDir = session.outDir;
  const config = session.config;
  const runId = runIdOf(session);
  const charter = session.charter?.trim();
  const outlines =
    charter && runId
      ? [
          {
            runId,
            outline: {
              charter,
              notes: [...(session.notes ?? [])],
              goods: [...(session.goods ?? [])],
              ...(session.plan ? { plan: session.plan } : {}),
            },
          },
        ]
      : undefined;
  const summary = clipHostText(args.summary);
  const extra = clipHostText(args.extra);
  const intro = session.config?.intro;
  let result: ExploreResult;
  try {
    result = await session.finish();
  } catch (err) {
    return textResult(errText(err), true);
  }
  host.lastWalk = {
    log: {
      ...result.log,
      steps: [...result.log.steps],
      usedLocators: { ...result.log.usedLocators },
    },
    logPath: result.logPath,
    configPath,
    ...(intro ? { intro } : {}),
  };
  const lines = [`sessionPath: ${result.sessionPath}`, `logPath: ${result.logPath}`];
  if (args.report !== false && outDir) {
    let leash = config;
    if (!leash) {
      try {
        leash = loadConfig(configPath);
      } catch (err) {
        return textResult(`${lines.join("\n")}\n${errText(err)}`, true);
      }
    }
    const pending = {
      configPath,
      config: leash,
      outDir,
      ...(summary ? { summary } : {}),
      ...(extra ? { extra } : {}),
      ...(outlines ? { outlines } : {}),
    };
    try {
      const written = await writeRunsReport({
        configPath: pending.configPath,
        config: pending.config,
        runDirs: [pending.outDir],
        ...(pending.summary ? { summary: pending.summary } : {}),
        ...(pending.extra ? { extra: pending.extra } : {}),
        ...(pending.outlines ? { outlines: pending.outlines } : {}),
        onBrainError: (message) => console.error(`brain skipped: ${message}`),
      });
      host.reported = true;
      host.pendingReport = undefined;
      lines.push(`report: ${written.mdPath}`);
    } catch (err) {
      host.pendingReport = pending;
      return textResult(`${lines.join("\n")}\n${errText(err)}`, true);
    }
  }
  return textResult(lines.join("\n"));
}

export async function handleExploreFinish(
  host: McpHost,
  args: { report?: boolean; summary?: string; extra?: string },
): Promise<McpToolResult> {
  if (!liveSession(host)) {
    if (args.report !== false && host.pendingReport) return flushPendingReport(host);
    return textResult("explore session is not started", true);
  }
  return finishExplore(host, args);
}

export async function handleNastyList(): Promise<McpToolResult> {
  const rows = listCatalogs().map((c) => `${c.id}\t${c.count}\t${c.description}`);
  return textResult(rows.join("\n") || "(none)");
}

export async function handleNastySamples(args: { id: string; dir?: string }): Promise<McpToolResult> {
  const opts = args.dir ? { dir: args.dir } : undefined;
  if (!listCatalogs(args.dir).some((c) => c.id === args.id)) {
    return textResult(`unknown catalog: ${args.id}`, true);
  }
  const samples = samplePayloads(args.id, opts);
  if (samples.length === 0) {
    return textResult(`catalog ${args.id} has no samples under ${SAMPLE_MAX_CHARS} chars`, true);
  }
  return textResult(samples.join("\n"));
}

export async function handleNastyFill(host: McpHost, args: { id?: string }): Promise<McpToolResult> {
  const session = requireLive(host);
  if (isToolResult(session)) return session;
  const view = session.currentView ?? (await session.visit()).view;
  const field = args.id ? view.shown.find((f) => f.id === args.id) : view.shown[0];
  if (!field) {
    const ids = view.shown.map((f) => f.id).join(", ") || "(none)";
    return textResult(`no mapped field on current visit (shown: ${ids})`, true);
  }
  const line = formatStep({ kind: "fill", surface: view.surface, id: field.id, value: pickNastyFill(field) });
  return handleExploreStep(host, { line });
}

export async function handleSpecList(host: McpHost): Promise<McpToolResult> {
  const configPath = configPathOf(host);
  const files = listSpecFiles(configPath);
  if (files.length === 0) return textResult("(none)");
  const root = dirname(configPath);
  const lines = files.map((file) => relative(root, file).split("\\").join("/"));
  return textResult(lines.join("\n"));
}

function resolveWalkLog(configPath: string, given: string): string | undefined {
  if (isAbsolute(given)) return existsSync(given) ? given : undefined;
  const fromLeash = resolve(dirname(configPath), given);
  if (existsSync(fromLeash)) return fromLeash;
  const fromCwd = resolve(process.cwd(), given);
  return existsSync(fromCwd) ? fromCwd : undefined;
}

function walksToFreeze(host: McpHost, logPath?: string): McpLastWalk[] | McpToolResult {
  const configPath = configPathOf(host);
  if (logPath) {
    const resolved = resolveWalkLog(configPath, logPath);
    if (!resolved) return textResult(`log not found: ${logPath}`, true);
    try {
      const config = loadConfig(configPath);
      return [{ log: readLog(resolved), logPath: resolved, configPath, intro: config.intro }];
    } catch (err) {
      return textResult(errText(err), true);
    }
  }
  const out: McpLastWalk[] = [];
  const live = liveSession(host);
  if (live) {
    try {
      const t = live.tape();
      out.push({
        log: t.log,
        logPath: t.logPath,
        configPath: live.configPath ?? configPath,
        ...(live.config?.intro ? { intro: live.config.intro } : {}),
      });
    } catch {
      // started flag without a tape
    }
  }
  if (host.lastWalk) out.push(host.lastWalk);
  if (out.length === 0) {
    return textResult(
      "no walk to freeze. explore_start … explore_finish, then spec_save — or pass log.",
      true,
    );
  }
  return out;
}

export async function handleSpecSave(
  host: McpHost,
  args: { title: string; file?: string; log?: string },
): Promise<McpToolResult> {
  const walks = walksToFreeze(host, args.log);
  if (!Array.isArray(walks)) return walks;
  const title = args.title.trim();
  if (!title) return textResult("spec title is required", true);
  let lastErr = "empty fence";
  for (const walk of walks) {
    try {
      const written = writeSpecMarkdown({
        configPath: walk.configPath,
        title,
        log: walk.log,
        logPath: walk.logPath,
        ...(walk.intro ? { intro: walk.intro } : {}),
        ...(args.file ? { fileName: args.file } : {}),
      });
      return textResult(
        [
          `spec: ${written.relative}`,
          `steps: ${written.steps}`,
          "ids: spec_check   replay: spec_run",
        ].join("\n"),
      );
    } catch (err) {
      lastErr = errText(err);
    }
  }
  return textResult(lastErr, true);
}

export async function handleSpecRun(
  host: McpHost,
  args: { path?: string; headed?: boolean } = {},
): Promise<McpToolResult> {
  if (liveSession(host)) {
    return textResult("explore session is live; explore_finish before spec_run", true);
  }
  const configPath = configPathOf(host);
  let config: Config;
  try {
    config = loadConfig(configPath);
  } catch (err) {
    return textResult(errText(err), true);
  }
  const files = listSpecFiles(configPath, args.path);
  if (files.length === 0) {
    return textResult(
      args.path ? `spec not found: ${args.path}` : "no spec files under clickmonkey/specs/",
      true,
    );
  }
  if (config.map.pages.length === 0) return textResult("map has no pages (run inspect)", true);
  const outDir = resolveOutDir(undefined, configPath);
  mkdirSync(outDir, { recursive: true });
  try {
    const play = host.runSpecs ?? runSpecs;
    const result = await play({
      config,
      configPath,
      outDir,
      files,
      headed: args.headed,
    });
    const lines = [
      formatSpecTable(result.cases).trimEnd(),
      `mdPath: ${result.mdPath}`,
      `logPath: ${result.logPath}`,
    ];
    return textResult(lines.join("\n"), !result.ok);
  } catch (err) {
    return textResult(errText(err), true);
  }
}

export async function handleSpecCheck(
  host: McpHost,
  args: { path?: string } = {},
): Promise<McpToolResult> {
  const configPath = configPathOf(host);
  let config: Config;
  try {
    config = loadConfig(configPath);
  } catch (err) {
    return textResult(errText(err), true);
  }
  const files = listSpecFiles(configPath, args.path);
  if (files.length === 0) {
    return textResult(
      args.path ? `spec not found: ${args.path}` : "no spec files under clickmonkey/specs/",
      true,
    );
  }
  if (config.map.pages.length === 0) return textResult("map has no pages (run inspect)", true);
  try {
    const model = requirePageModel(config.map);
    const results = files.map((filePath) => checkSpecFile(model, filePath));
    const missed = results.some((r) => r.cases.some((c) => c.missing.length > 0));
    return textResult(formatCheckReport(results), missed);
  } catch (err) {
    return textResult(errText(err), true);
  }
}

export function registerMcpTools(server: McpServer, host: McpHost): void {
  server.registerTool(
    "explore_init",
    {
      description: "Create clickmonkey.json + clickmonkey/ (same as clickmonkey init).",
      inputSchema: z.object({
        url: z.string().min(1),
        config: z.string().min(1).optional(),
      }),
    },
    async (args) => handleExploreInit(host, args),
  );
  server.registerTool(
    "explore_start",
    {
      description:
        "Start an explore run (browser). Does not require config.brain. Presence name is mcp. skills is architecture context kept on the session (not a second charter).",
      inputSchema: z.object({
        charter: z.string().min(1).optional(),
        skills: z.string().min(1).optional(),
        headed: z.boolean().optional(),
        config: z.string().min(1).optional(),
        map: z
          .string()
          .min(1)
          .optional()
          .describe("Sitemap JSON to load instead of clickmonkey/map.json (absolute or next to the leash)."),
      }),
    },
    async (args) => handleExploreStart(host, args),
  );
  server.registerTool(
    "explore_step",
    {
      description: "Run one DSL line on the live explore session.",
      inputSchema: z.object({
        line: z.string().min(1),
        note: z.string().min(1).optional(),
        good: z.string().min(1).optional(),
        done: z.boolean().optional(),
      }),
    },
    async (args) => handleExploreStep(host, args),
  );
  server.registerTool(
    "explore_visit",
    {
      description:
        "Snapshot the current surface. Default is the compact token-saving visit (no HTML, no PNG). full=true lists every mapped widget including disabled Save.",
      inputSchema: z.object({
        full: z.boolean().optional(),
      }),
    },
    async (args) => handleExploreVisit(host, args),
  );
  server.registerTool(
    "explore_shot",
    {
      description: "Return the latest (or given) PNG as image content.",
      inputSchema: z.object({
        path: z.string().min(1).optional(),
      }),
    },
    async (args) => handleExploreShot(host, args),
  );
  server.registerTool(
    "explore_set_plan",
    {
      description: "Set the explore plan from host JSON { goal, items }.",
      inputSchema: z.object({
        goal: z.string().min(1),
        items: z
          .array(
            z.object({
              title: z.string().min(1),
              page: z.string().min(1).optional(),
            }),
          )
          .min(2)
          .max(8),
      }),
    },
    async (args) => handleExploreSetPlan(host, args),
  );
  server.registerTool(
    "explore_advance",
    {
      description: "Mark the current plan item done or skipped.",
      inputSchema: z.object({
        status: z.enum(["done", "skipped"]),
      }),
    },
    async (args) => handleExploreAdvance(host, args),
  );
  server.registerTool(
    "explore_note",
    {
      description: "Record an oracle note on the live session.",
      inputSchema: z.object({ text: z.string().min(1) }),
    },
    async (args) => handleExploreNote(host, args),
  );
  server.registerTool(
    "explore_good",
    {
      description: "Record a positive observation on the live session.",
      inputSchema: z.object({ text: z.string().min(1) }),
    },
    async (args) => handleExploreGood(host, args),
  );
  server.registerTool(
    "explore_quality",
    {
      description: "Compact quality digest for the current page (this run's ledger, not a rescan).",
      inputSchema: z.object({}),
    },
    async () => handleExploreQuality(host),
  );
  server.registerTool(
    "explore_findings",
    {
      description: "List findings already persisted for this live run (id, kind, severity, path, shot, message).",
      inputSchema: z.object({}),
    },
    async () => handleExploreFindings(host),
  );
  server.registerTool(
    "explore_finding",
    {
      description:
        "File a host-observed product bug with a screenshot (same as screenshot ui). Resets to the seed page. Default severity major.",
      inputSchema: z.object({
        message: z.string().min(1),
        severity: z.enum(["major", "minor", "suggestion"]).optional(),
      }),
    },
    async (args) => handleExploreFinding(host, args),
  );
  server.registerTool(
    "explore_finish",
    {
      description:
        "End the run, write session.md, and (default) a findings report. summary is the report lead (Grok's story). extra is optional appendix markdown.",
      inputSchema: z.object({
        report: z.boolean().optional(),
        summary: z.string().min(1).optional(),
        extra: z.string().min(1).optional(),
      }),
    },
    async (args) => handleExploreFinish(host, args),
  );
  server.registerTool(
    "spec_list",
    {
      description: "List markdown specs under clickmonkey/specs/ (no live session).",
      inputSchema: z.object({}),
    },
    async () => handleSpecList(host),
  );
  server.registerTool(
    "spec_save",
    {
      description:
        "Freeze the last MCP walk (or a log.txt) as clickmonkey/specs/*.md. Compacted tape, intro stays in the leash. Then spec_check and spec_run.",
      inputSchema: z.object({
        title: z.string().min(1),
        file: z.string().min(1).optional(),
        log: z.string().min(1).optional(),
      }),
    },
    async (args) => handleSpecSave(host, args),
  );
  server.registerTool(
    "spec_check",
    {
      description: "Validate spec fence ids against the map (offline; same as clickmonkey spec --check).",
      inputSchema: z.object({
        path: z.string().min(1).optional(),
      }),
    },
    async (args) => handleSpecCheck(host, args),
  );
  server.registerTool(
    "spec_run",
    {
      description:
        "Live-replay spec fences in a browser (same as CLI clickmonkey spec). Prove the freeze works. explore_finish first.",
      inputSchema: z.object({
        path: z.string().min(1).optional(),
        headed: z.boolean().optional(),
      }),
    },
    async (args) => handleSpecRun(host, args),
  );
  server.registerTool(
    "nasty_list",
    {
      description: `List payload catalogs. ${NASTY_WARNING}`,
      inputSchema: z.object({}),
    },
    async () => handleNastyList(),
  );
  server.registerTool(
    "nasty_samples",
    {
      description: `Sample short payloads from a catalog. ${NASTY_WARNING}`,
      inputSchema: z.object({ id: z.string().min(1) }),
    },
    async (args) => handleNastySamples(args),
  );
  server.registerTool(
    "nasty_fill",
    {
      description: `Fill a mapped field on the current visit from the payload catalog. ${NASTY_WARNING}`,
      inputSchema: z.object({
        id: z.string().min(1).optional(),
      }),
    },
    async (args) => handleNastyFill(host, args),
  );
}

function promptResult(text: string) {
  return {
    messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
  };
}

export function registerMcpPrompts(server: McpServer): void {
  server.registerPrompt(
    "clickmonkey",
    { description: "What ClickMonkey is for: map, unleash, nasty, explore, spec, replay." },
    () => promptResult(CLICKMONKEY_GUIDE),
  );
  server.registerPrompt(
    "explore_tester",
    { description: "RST exploratory testing skills (oracles, good, next, done)." },
    () => promptResult(defaultExploreSkills()),
  );
  server.registerPrompt(
    "explore_plan",
    { description: "Plan a time-boxed explore session as JSON items." },
    () => promptResult(EXPLORE_PLAN_SYSTEM),
  );
  server.registerPrompt(
    "explore_report",
    { description: "Write a digest from visits, notes, goods, and shot paths." },
    () => promptResult(EXPLORE_REPORT_PROMPT),
  );
  server.registerPrompt(
    "spec_writer",
    { description: "How to create a good replayable spec (when, walk, fence, prove)." },
    () => promptResult(defaultSpecSkills()),
  );
}

export function sessionResourceText(host: McpHost): string {
  const session = liveSession(host);
  if (!session) return "no live session\n";
  const path = session.outDir ? join(session.outDir, "session.md") : undefined;
  if (path && existsSync(path)) return readFileSync(path, "utf8");
  return liveSessionSummary(session);
}

function liveSessionSummary(session: McpSession): string {
  const runId = runIdOf(session);
  const notes = session.notes ?? [];
  const goods = session.goods ?? [];
  const findings = session.findings ?? [];
  const plan = session.plan;
  const planBlock = plan
    ? [plan.goal, ...plan.items.map((it) => formatExplorePlanItemLine(it))].join("\n")
    : "(none)";
  const skills = session.skills?.trim();
  return [
    runId ? `run: ${runId}` : "run: (none)",
    `charter: ${session.charter ?? "(none)"}`,
    skills ? `skills: ${clipLine(skills, VISIT_SIGHT_MAX)}` : "skills: (none)",
    "## Plan",
    planBlock,
    "## Notes",
    notes.length > 0 ? notes.map((n) => `- ${n}`).join("\n") : "(none)",
    "## Positive observations",
    goods.length > 0 ? goods.map((n) => `- ${n}`).join("\n") : "(none)",
    "## Findings",
    (() => {
      const listed = formatFindingsList(session.outDir);
      if (listed !== "(none)") return listed;
      if (findings.length > 0) return findings.map((f) => `- ${f.id}: ${f.message}`).join("\n");
      return "(none)";
    })(),
    "session.md is written on explore_finish",
    "",
  ].join("\n");
}

export function registerMcpResources(server: McpServer, host: McpHost): void {
  server.registerResource(
    "guide",
    "clickmonkey://guide",
    { title: "ClickMonkey monkeys (map, unleash, nasty, explore, mcp)", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, text: `${CLICKMONKEY_GUIDE}\n` }] }),
  );
  server.registerResource(
    "oracles",
    "clickmonkey://oracles",
    { title: "Explore oracles", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, text: defaultExploreSkills() }] }),
  );
  server.registerResource(
    "spec",
    "clickmonkey://spec",
    { title: "How to create a replayable spec", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, text: defaultSpecSkills() }] }),
  );
  server.registerResource(
    "map",
    "clickmonkey://map",
    { title: "Sitemap", mimeType: "application/json" },
    async (uri) => {
      const liveMap = liveSession(host)?.config?.map;
      if (liveMap) {
        return { contents: [{ uri: uri.href, text: `${JSON.stringify(liveMap, null, 2)}\n` }] };
      }
      const path = host.mapPath ?? mapPath(configPathOf(host));
      const text = existsSync(path) ? readFileSync(path, "utf8") : "{}\n";
      return { contents: [{ uri: uri.href, text }] };
    },
  );
  server.registerResource(
    "session",
    "clickmonkey://session",
    { title: "Live explore session.md", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, text: sessionResourceText(host) }] }),
  );
  server.registerResource(
    "nasty",
    "clickmonkey://nasty",
    { title: "Payload catalogs", mimeType: "application/json" },
    async (uri) => ({
      contents: [{ uri: uri.href, text: `${JSON.stringify(listCatalogs(), null, 2)}\n` }],
    }),
  );
}
