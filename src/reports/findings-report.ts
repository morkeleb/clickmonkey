import { dirname, relative } from "node:path";
import { z } from "zod";
import { chat, type ChatClient } from "../brains/chat.js";
import type { FindingCase } from "../persist/runs.js";
import type { Config } from "../schema/config.js";
import { severityForKind, type FindingSeverity } from "../schema/finding.js";
import { parseLog } from "../schema/dsl.js";
import type { QualityReport, QualityPage, QualityIssue, QualityRuntimeEvent } from "../schema/quality.js";
import { qualityPageCounts } from "../schema/quality.js";
import { sameLedgerPage, type TestabilityReport, type TestabilityPage } from "../schema/testability.js";
import { wrapClickmonkeyFence } from "./fences.js";

const SEV_ORDER: FindingSeverity[] = ["critical", "major", "minor", "suggestion"];

const LlmItems = z.object({
  summary: z.string().min(1),
  items: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      expected: z.string().optional(),
      actual: z.string().optional(),
      why: z.string().optional(),
    }),
  ),
});

export function caseKey(c: Pick<FindingCase, "runId" | "id">): string {
  return `${c.runId}/${c.id}`;
}

export interface ReportMeta {
  url: string;
  generatedAt: string;
  runIds: string[];
  brain?: string;
  testability?: TestabilityReport;
  quality?: QualityReport;
}

function resolveApiKey(apiKeyEnv: string | undefined): string | undefined {
  if (!apiKeyEnv) return undefined;
  const value = process.env[apiKeyEnv];
  if (!value) throw new Error(`${apiKeyEnv} is not set`);
  return value;
}

function groupBySeverity(cases: FindingCase[]): Map<FindingSeverity, FindingCase[]> {
  const map = new Map<FindingSeverity, FindingCase[]>();
  for (const sev of SEV_ORDER) map.set(sev, []);
  for (const c of cases) {
    const sev = c.severity ?? severityForKind(c.finding.kind);
    map.get(sev)?.push(c);
  }
  return map;
}

function shotMarkdown(abs: string | undefined, reportPath: string): string | undefined {
  if (!abs) return undefined;
  const rel = relative(dirname(reportPath), abs);
  const href = rel.split("\\").join("/");
  return `![screenshot](${href})`;
}

function renderCase(
  c: FindingCase,
  reportPath: string,
  extra?: { title?: string; expected?: string; actual?: string; why?: string },
): string {
  const title = extra?.title || c.title;
  const lines = [
    `### ${title}`,
    "",
    `- **id:** ${c.id}`,
    `- **severity:** ${c.severity}`,
    `- **kind:** ${c.finding.kind}`,
    `- **run:** ${c.runId}`,
  ];
  if (c.finding.url) lines.push(`- **url:** ${c.finding.url}`);
  lines.push("");
  if (extra?.expected) {
    lines.push(`**Expected:** ${extra.expected}`, "");
  }
  if (extra?.actual) {
    lines.push(`**Actual:** ${extra.actual}`, "");
  } else {
    lines.push(c.description.trim(), "");
  }
  if (extra?.why) {
    lines.push(`**Why it matters:** ${extra.why}`, "");
  }
  const shot = shotMarkdown(c.screenshotPath, reportPath);
  if (shot) lines.push(shot, "");
  if (c.tape.trim()) {
    const log = parseLog(c.tape);
    if (!log.bug) log.bug = c.finding.message;
    lines.push(wrapClickmonkeyFence(log), "");
  }
  return lines.join("\n");
}

function formatIssueLine(i: QualityIssue | QualityRuntimeEvent): string {
  const times = i.count > 1 ? ` ×${i.count}` : "";
  return `- \`${i.rule}\` ${i.severity}${times} — ${i.message}`;
}

function pageHasQuality(testability?: TestabilityPage, quality?: QualityPage): boolean {
  if (testability && testability.issues.length > 0) return true;
  if (!quality) return false;
  return quality.html.length + quality.a11y.length + quality.runtime.length > 0;
}

function qualityHeading(page: { path: string; origin?: string }): string {
  return page.origin ? `${page.path} @ ${page.origin}` : page.path;
}

export function renderQualitySection(
  testability?: TestabilityReport,
  quality?: QualityReport,
): string[] {
  const keys: Array<{ path: string; origin?: string }> = [];
  const add = (page: { path: string; origin?: string }) => {
    if (!keys.some((k) => sameLedgerPage(k, page))) keys.push({ path: page.path, origin: page.origin });
  };
  for (const p of testability?.pages ?? []) {
    if (p.issues.length > 0) add(p);
  }
  for (const p of quality?.pages ?? []) {
    if (p.html.length + p.a11y.length + p.runtime.length > 0) add(p);
  }
  if (keys.length === 0) return [];

  const lines = [
    "## Quality",
    "",
    "Recorded while walking — HTML (html-validate), accessibility (axe-core), testability, and JavaScript. No LLM.",
    "",
  ];
  keys.sort((a, b) => {
    const o = (a.origin ?? "").localeCompare(b.origin ?? "");
    return o !== 0 ? o : a.path.localeCompare(b.path);
  });
  for (const key of keys) {
    const t = testability?.pages.find((p) => sameLedgerPage(p, key));
    const q = quality?.pages.find((p) => sameLedgerPage(p, key));
    if (!pageHasQuality(t, q)) continue;
    const counts = q ? qualityPageCounts(q) : { errors: 0, warnings: 0 };
    const tBlocks = t?.issues.filter((i) => i.severity === "block").length ?? 0;
    const tWarns = (t?.issues.length ?? 0) - tBlocks;
    const errors = counts.errors + tBlocks;
    const warnings = counts.warnings + tWarns;
    const flag = t?.insufficient ? ", insufficient" : "";
    lines.push(
      `### \`${qualityHeading(key)}\` — ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}${flag}`,
      "",
    );
    if (t && t.issues.length > 0) {
      lines.push("**Testability**", "");
      for (const i of t.issues) {
        const extra = [i.role, i.inputType].filter(Boolean).join(" ");
        lines.push(
          extra
            ? `- \`${i.code}\` ${i.severity} · ${i.tag} ${extra}`
            : `- \`${i.code}\` ${i.severity} · ${i.tag}`,
        );
      }
      lines.push("");
    }
    if (q && q.html.length > 0) {
      lines.push("**HTML**", "");
      for (const i of q.html) lines.push(formatIssueLine(i));
      lines.push("");
    }
    if (q && q.a11y.length > 0) {
      lines.push("**Accessibility**", "");
      for (const i of q.a11y) lines.push(formatIssueLine(i));
      lines.push("");
    }
    if (q && q.runtime.length > 0) {
      lines.push("**JavaScript**", "");
      for (const i of q.runtime) lines.push(formatIssueLine(i));
      lines.push("");
    }
  }
  return lines;
}

export function renderFindingsReport(
  cases: FindingCase[],
  meta: ReportMeta,
  reportPath: string,
  llm?: Map<string, { title?: string; expected?: string; actual?: string; why?: string }>,
  summary?: string,
): string {
  const counts = SEV_ORDER.map((s) => {
    const n = cases.filter((c) => c.severity === s).length;
    return n > 0 ? `${n} ${s}` : undefined;
  }).filter(Boolean);
  const qualityLines = renderQualitySection(meta.testability, meta.quality);
  const lines = [
    "# Findings report",
    "",
    "## Summary",
    "",
    summary?.trim() ||
      `${cases.length} finding${cases.length === 1 ? "" : "s"} from ${meta.runIds.length} run${meta.runIds.length === 1 ? "" : "s"} (${counts.join(", ") || "none"}).`,
    "",
    `- **url:** ${meta.url}`,
    `- **generated:** ${meta.generatedAt}`,
    `- **runs:** ${meta.runIds.join(", ") || "(none)"}`,
    ...(meta.brain ? [`- **brain:** ${meta.brain}`] : []),
    "",
    ...qualityLines,
    ...(qualityLines.length > 0 ? [""] : []),
    "## Findings",
    "",
  ];
  const grouped = groupBySeverity(cases);
  for (const sev of SEV_ORDER) {
    const items = grouped.get(sev) ?? [];
    if (items.length === 0) continue;
    lines.push(`## ${sev[0]!.toUpperCase()}${sev.slice(1)}`, "");
    for (const c of items) {
      lines.push(renderCase(c, reportPath, llm?.get(caseKey(c))), "");
    }
  }
  if (cases.length === 0) {
    lines.push("_No findings in the selected runs._", "");
  }
  lines.push("## Appendix", "", "Source finding folders live under each run's `findings/` directory.", "");
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

export async function enrichWithBrain(
  cases: FindingCase[],
  config: Config,
  invoke: ChatClient = chat,
): Promise<{ summary: string; extras: Map<string, { title?: string; expected?: string; actual?: string; why?: string }> }> {
  const extras = new Map<string, { title?: string; expected?: string; actual?: string; why?: string }>();
  const brain = config.brain;
  if (!brain?.baseUrl || !brain.model || cases.length === 0) {
    return { summary: "", extras };
  }
  const digest = cases.map((c) => ({
    id: caseKey(c),
    kind: c.finding.kind,
    severity: c.severity,
    message: c.finding.message,
    description: c.description.slice(0, 800),
  }));
  const raw = await invoke({
    baseUrl: brain.baseUrl,
    model: brain.model,
    apiKey: resolveApiKey(brain.apiKeyEnv),
    messages: [
      {
        role: "system",
        content: [
          "You write a short exploratory / usability findings digest.",
          "Reply with JSON only: { \"summary\": \"...\", \"items\": [{ \"id\", \"title\", \"expected\", \"actual\", \"why\" }] }.",
          "Use only the provided ids (runId/findingId). Do not invent reproduction steps.",
          "Titles: area – action – unexpected result.",
          "summary: 2–4 sentences, highest-severity first.",
        ].join("\n"),
      },
      { role: "user", content: JSON.stringify(digest) },
    ],
  });
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return { summary: "", extras };
  const parsed = LlmItems.safeParse(JSON.parse(raw.slice(start, end + 1)));
  if (!parsed.success) return { summary: "", extras };
  const known = new Set(cases.map(caseKey));
  for (const item of parsed.data.items) {
    if (!known.has(item.id)) continue;
    extras.set(item.id, {
      title: item.title,
      ...(item.expected ? { expected: item.expected } : {}),
      ...(item.actual ? { actual: item.actual } : {}),
      ...(item.why ? { why: item.why } : {}),
    });
  }
  return { summary: parsed.data.summary, extras };
}
