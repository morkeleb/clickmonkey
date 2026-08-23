import { z } from "zod";
import { chat, type ChatClient } from "../brains/chat.js";
import type { Config } from "../schema/config.js";

const LOC_LINE =
  /`([A-Za-z]+)` · (\w+)(?: · \d+× in \d+ runs?)? · `(fnd_[^`]+)`/;
const COPY_LINE = /^- \S+ `(fnd_[^`]+)`/;

export type ReportFinding = {
  id: string;
  ids: string[];
  kind: string;
  severity: string;
  title: string;
  heading: string;
  markdown: string;
};

function findingsBounds(markdown: string): { start: number; end: number } | undefined {
  const start = markdown.search(/^## Findings\s*$/m);
  if (start < 0) return undefined;
  const after = markdown.slice(start + 1);
  const rel = after.search(/^## (?:Quality|Extra|Appendix)\s*$/m);
  const end = rel < 0 ? markdown.length : start + 1 + rel;
  return { start, end };
}

function parseBlock(heading: string, raw: string): ReportFinding | undefined {
  const text = raw.replace(/^\s+/, "").replace(/\s+$/, "") + "\n";
  const titleLine = text.split(/\r?\n/)[0] ?? "";
  const title = titleLine.replace(/^###\s+/, "").trim();
  if (!title) return undefined;
  const loc = LOC_LINE.exec(text);
  if (!loc) return undefined;
  const ids = new Set<string>([loc[3]!]);
  for (const line of text.split(/\r?\n/)) {
    const copy = COPY_LINE.exec(line);
    if (copy?.[1]) ids.add(copy[1]);
  }
  return {
    id: loc[3]!,
    ids: [...ids],
    kind: loc[1]!,
    severity: loc[2]!,
    title,
    heading,
    markdown: text.endsWith("\n") ? text : `${text}\n`,
  };
}

export function parseReportFindings(markdown: string): ReportFinding[] {
  const bounds = findingsBounds(markdown);
  if (!bounds) return [];
  const slice = markdown.slice(bounds.start, bounds.end);
  const body = slice.replace(/^## Findings\s*$/m, "");
  const parts = body.split(/^(## (?:Critical|Major|Minor|Suggestion))\s*$/m);
  const out: ReportFinding[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const heading = parts[i]!;
    const chunk = parts[i + 1] ?? "";
    const blocks = chunk.split(/^(?=### )/m);
    for (const block of blocks) {
      if (!/^### /m.test(block)) continue;
      const parsed = parseBlock(heading, block);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

function dropSet(findings: ReportFinding[], dropIds: Iterable<string>): Set<string> {
  const want = new Set(dropIds);
  const drop = new Set<string>();
  for (const f of findings) {
    if (want.has(f.id) || f.ids.some((id) => want.has(id))) drop.add(f.id);
  }
  return drop;
}

function summaryLine(kept: ReportFinding[], from: string): string {
  const runMatch = from.match(/from (\d+) runs?/);
  const runN = runMatch?.[1] ? Number(runMatch[1]) : undefined;
  const runs =
    runN !== undefined
      ? `${runN} run${runN === 1 ? "" : "s"}`
      : (from.match(/from .+$/)?.[0]?.replace(/^from /, "") ?? "runs");
  const counts = (["critical", "major", "minor", "suggestion"] as const)
    .map((s) => {
      const n = kept.filter((f) => f.severity === s).length;
      return n > 0 ? `${n} ${s}` : undefined;
    })
    .filter(Boolean);
  const n = kept.length;
  return `${n} finding${n === 1 ? "" : "s"} from ${runs} (${counts.join(", ") || "none"}).`;
}

export function dropReportFindings(
  markdown: string,
  dropIds: Iterable<string>,
): { markdown: string; dropped: ReportFinding[]; kept: ReportFinding[] } {
  const findings = parseReportFindings(markdown);
  const drop = dropSet(findings, dropIds);
  const dropped = findings.filter((f) => drop.has(f.id));
  const kept = findings.filter((f) => !drop.has(f.id));
  if (dropped.length === 0) return { markdown, dropped, kept };
  const bounds = findingsBounds(markdown);
  if (!bounds) return { markdown, dropped, kept };
  const groups = new Map<string, ReportFinding[]>();
  for (const f of kept) {
    const list = groups.get(f.heading) ?? [];
    list.push(f);
    groups.set(f.heading, list);
  }
  const order = ["## Critical", "## Major", "## Minor", "## Suggestion"];
  const findingsOut: string[] = ["## Findings", ""];
  if (kept.length === 0) {
    findingsOut.push("_No findings in the selected runs._", "");
  } else {
    for (const heading of order) {
      const list = groups.get(heading);
      if (!list?.length) continue;
      findingsOut.push(heading, "");
      for (const f of list) {
        findingsOut.push(f.markdown.replace(/\s+$/, ""), "");
      }
    }
  }
  let before = markdown.slice(0, bounds.start);
  before = before.replace(/^\d+ findings? from .+$/m, (line) => summaryLine(kept, line));
  const after = markdown.slice(bounds.end);
  const next = `${before}${findingsOut.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n\n${after.replace(/^\s+/, "")}`;
  return { markdown: next.replace(/\n{3,}/g, "\n\n").trim() + "\n", dropped, kept };
}

const SuggestJson = z.object({
  drop: z.array(
    z.object({
      id: z.string().min(1),
      reason: z.string().min(1),
    }),
  ),
});

function resolveApiKey(apiKeyEnv: string | undefined): string | undefined {
  if (!apiKeyEnv) return undefined;
  const value = process.env[apiKeyEnv];
  if (!value) throw new Error(`${apiKeyEnv} is not set`);
  return value;
}

/** Brain pass: which listed findings look like walker false positives. */
export async function suggestFalsePositives(
  findings: ReportFinding[],
  markdown: string,
  config: Config,
  invoke: ChatClient = chat,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const brain = config.brain;
  if (!brain?.baseUrl || !brain.model || findings.length === 0) return out;
  const known = new Set(findings.flatMap((f) => f.ids));
  const digest = findings.map((f) => ({
    id: f.id,
    kind: f.kind,
    severity: f.severity,
    title: f.title,
  }));
  const bounds = findingsBounds(markdown);
  const slice = bounds ? markdown.slice(bounds.start, bounds.end) : markdown;
  const clipped = slice.length > 12_000 ? `${slice.slice(0, 11_999)}…` : slice;
  const raw = await invoke({
    baseUrl: brain.baseUrl,
    model: brain.model,
    apiKey: resolveApiKey(brain.apiKeyEnv),
    messages: [
      {
        role: "system",
        content: [
          "You review a ClickMonkey findings report for false positives after a human walk.",
          "Drop walker/harness noise: expected overlays, fence bounces, junk the walker typed that is not a product defect, duplicate restatements, locator timeouts.",
          "Keep real product bugs: uncaught JS, HTTP 404/5xx, missing validation, sheared product text, broken writes.",
          'JSON only: { "drop": [{ "id": "fnd_…", "reason": "one line" }] }.',
          "Use only provided ids. Empty drop is allowed.",
        ].join("\n"),
      },
      { role: "user", content: JSON.stringify({ findings: digest, report: clipped }) },
    ],
  });
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return out;
  let json: unknown;
  try {
    json = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return out;
  }
  const parsed = SuggestJson.safeParse(json);
  if (!parsed.success) return out;
  for (const item of parsed.data.drop) {
    if (!known.has(item.id)) continue;
    const reason = item.reason.replace(/\s+/g, " ").trim();
    if (reason) out.set(item.id, reason);
  }
  return out;
}
