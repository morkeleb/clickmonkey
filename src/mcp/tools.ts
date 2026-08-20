import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  defaultExploreSkills,
  EXPLORE_PLAN_SYSTEM,
  formatPlanningCards,
  formatReachDag,
  isScreenshotLine,
  parseExplorePlanReply,
} from "../brains/explore.js";
import { listCatalogs, pickNasty, samplePayloads } from "../brains/nasty.js";
import { resolveConfigPath, resolveOutDir } from "../cli/common.js";
import { loadConfig, saveConfig } from "../persist/config.js";
import { loadQualityReport, qualityReportPath } from "../persist/quality.js";
import { loadTestabilityReport, testabilityReportPath } from "../persist/testability.js";
import { mapPath } from "../persist/workspace.js";
import {
  ExploreSession,
  EXPLORE_REPORT_PROMPT,
  type ExploreResult,
  type ExploreStepOpts,
  type ExploreStepResult,
} from "../playbooks/explore-session.js";
import { renderQualityDigest, writeRunsReport } from "../reports/findings-report.js";
import type { Config } from "../schema/config.js";
import { emptyConfig } from "../schema/config.js";
import { formatStep } from "../schema/dsl.js";
import type { Page } from "../schema/page-model.js";
import type { UiExplorePlan } from "../schema/ui.js";
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
  "start" | "visit" | "step" | "setPlan" | "advancePlan" | "addNote" | "addGood" | "finish"
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
};

export type McpHost = {
  configFlag?: string;
  session?: McpSession;
  createSession?: () => McpSession;
};

const PROMPT_NAMES = "prompts: explore_tester, explore_plan, explore_report";

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

function formatVisitText(visit: ExploreVisit, session?: McpSession): string {
  const runId = session ? runIdOf(session) : "";
  const ready = visit.ready ? JSON.stringify(visit.ready) : "";
  const last = visit.view.last
    ? `${visit.view.last.ok ? "ok" : "fail"} ${visit.view.last.step}${visit.view.last.finding ? ` ${visit.view.last.finding}` : ""}`
    : "";
  const header = [
    runId ? `run: ${runId}` : undefined,
    `mode: ${visit.mode}`,
    ready ? `ready: ${ready}` : undefined,
    `legalOpen: ${visit.legalOpen.join(", ") || "(none)"}`,
    visit.shot ? `shot: ${visit.shot}` : undefined,
    visit.planLine ? `planLine: ${visit.planLine}` : undefined,
    last ? `last: ${last}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
  return `${header}\n\n${visit.formatted}`;
}

function startExtras(visit: ExploreVisit, session: McpSession): string {
  const pages = session.pages ?? [];
  const skip = session.config?.skip;
  const cards = pages.length > 0 ? formatPlanningCards(pages, { skip }) : "";
  const dag = pages.length > 0 ? formatReachDag(pages, { skip }) : "";
  return [cards, dag, `Legal open ids: ${visit.legalOpen.join(", ") || "(none)"}`, PROMPT_NAMES]
    .filter(Boolean)
    .join("\n\n");
}

function pngContent(path: string): McpContent {
  return { type: "image", mimeType: "image/png", data: readFileSync(path).toString("base64") };
}

function resolveShot(session: McpSession, given?: string): string | undefined {
  if (given) {
    if (isAbsolute(given)) return given;
    if (session.outDir) return join(session.outDir, given);
    return resolve(process.cwd(), given);
  }
  return session.lastScreenshotPath;
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
  args: { charter?: string; skills?: string; headed?: boolean; config?: string },
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
  } catch (err) {
    return textResult(errText(err), true);
  }
  const outDir = resolveOutDir(undefined, configPath);
  mkdirSync(outDir, { recursive: true });
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
    return textResult(`${formatVisitText(visit, session)}\n\n${startExtras(visit, session)}`);
  } catch (err) {
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
  if (isScreenshotLine(args.line)) {
    const shot = session.lastScreenshotPath;
    if (shot && existsSync(shot)) {
      return { content: [{ type: "text", text }, pngContent(shot)] };
    }
  }
  return textResult(text);
}

export async function handleExploreVisit(host: McpHost): Promise<McpToolResult> {
  const session = requireLive(host);
  if (isToolResult(session)) return session;
  try {
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
  const quality = loadQualityReport(qualityReportPath(configPath));
  const testability = loadTestabilityReport(testabilityReportPath(configPath));
  const lines = renderQualityDigest(
    { schemaVersion: 1, pages: testability.pages.filter((p) => sameLedgerPage(p, key)) },
    { schemaVersion: 1, pages: quality.pages.filter((p) => sameLedgerPage(p, key)) },
  );
  return textResult(lines.join("\n") || `no quality ledger for ${path}`);
}

export async function handleExploreFinish(
  host: McpHost,
  args: { report?: boolean },
): Promise<McpToolResult> {
  const session = requireLive(host);
  if (isToolResult(session)) return session;
  const configPath = session.configPath ?? configPathOf(host);
  const outDir = session.outDir;
  const config = session.config;
  let result: ExploreResult;
  try {
    result = await session.finish();
  } catch (err) {
    return textResult(errText(err), true);
  }
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
    try {
      const written = await writeRunsReport({
        configPath,
        config: leash,
        runDirs: [outDir],
        onBrainError: (message) => console.error(`brain skipped: ${message}`),
      });
      lines.push(`report: ${written.mdPath}`);
    } catch (err) {
      return textResult(`${lines.join("\n")}\n${errText(err)}`, true);
    }
  }
  return textResult(lines.join("\n"));
}

export async function handleNastyList(): Promise<McpToolResult> {
  const rows = listCatalogs().map((c) => `${c.id}\t${c.count}\t${c.description}`);
  return textResult(rows.join("\n") || "(none)");
}

export async function handleNastySamples(args: { id: string }): Promise<McpToolResult> {
  const samples = samplePayloads(args.id);
  if (samples.length === 0) return textResult(`unknown catalog: ${args.id}`, true);
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
  const line = formatStep({ kind: "fill", surface: view.surface, id: field.id, value: pickNasty(field.type) });
  return handleExploreStep(host, { line });
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
        "Start an explore run (browser). Does not require config.brain. Presence name is mcp.",
      inputSchema: z.object({
        charter: z.string().min(1).optional(),
        skills: z.string().min(1).optional(),
        headed: z.boolean().optional(),
        config: z.string().min(1).optional(),
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
      description: "Snapshot the current surface as a compact visit (no HTML, no PNG).",
      inputSchema: z.object({}),
    },
    async () => handleExploreVisit(host),
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
      description: "Compact quality.json digest for the current page (ledger, not a rescan).",
      inputSchema: z.object({}),
    },
    async () => handleExploreQuality(host),
  );
  server.registerTool(
    "explore_finish",
    {
      description: "End the run, write session.md, and (default) a findings report for this run.",
      inputSchema: z.object({
        report: z.boolean().optional(),
      }),
    },
    async (args) => handleExploreFinish(host, args),
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
}

export function registerMcpResources(server: McpServer, host: McpHost): void {
  server.registerResource(
    "oracles",
    "clickmonkey://oracles",
    { title: "Explore oracles", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, text: defaultExploreSkills() }] }),
  );
  server.registerResource(
    "map",
    "clickmonkey://map",
    { title: "Sitemap", mimeType: "application/json" },
    async (uri) => {
      const path = mapPath(configPathOf(host));
      const text = existsSync(path) ? readFileSync(path, "utf8") : "{}\n";
      return { contents: [{ uri: uri.href, text }] };
    },
  );
  server.registerResource(
    "session",
    "clickmonkey://session",
    { title: "Live explore session.md", mimeType: "text/markdown" },
    async (uri) => {
      const session = liveSession(host);
      const path = session?.outDir ? join(session.outDir, "session.md") : undefined;
      const text =
        path && existsSync(path) ? readFileSync(path, "utf8") : "no live session\n";
      return { contents: [{ uri: uri.href, text }] };
    },
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
