import { dirname, relative } from "node:path";
import { z } from "zod";
import { chat, type ChatClient } from "../brains/chat.js";
import { collectFindingCases, type FindingCase } from "../persist/runs.js";
import { loadPresence, presencePath } from "../persist/presence.js";
import { loadCombinedQuality } from "../persist/quality.js";
import { plannedReportPath, writeReportFolder } from "../persist/reports.js";
import { newRunId } from "../persist/run-id.js";
import { loadCombinedTestability } from "../persist/testability.js";
import type { Config } from "../schema/config.js";
import { formatExplorePlanItemLine, type UiExploreOutline } from "../schema/ui.js";
import {
  findingReportTitle,
  pageErrorExplanation,
  severityForKind,
  type FindingSeverity,
} from "../schema/finding.js";
import { templatizePath } from "../surveyor/path-template.js";
import { applyDuplicateTitles } from "../surveyor/seo.js";
import { parseLog } from "../schema/dsl.js";
import type { QualityReport, QualityPage, QualityIssue, QualityRuntimeEvent } from "../schema/quality.js";
import { joinWheres, qualityLedgerItems, qualityPageCounts } from "../schema/quality.js";
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

/** Collapse the same product bug seen in several runs (or twice in one run). */
export function findingFingerprint(c: FindingCase): string {
  const kind = c.finding.kind;
  const path = pathOfHref(c.finding.url ?? c.url ?? "") ?? "";
  if (kind === "notFound") return `notFound\t${path}`;
  if (kind === "httpError") return `httpError\t${c.finding.httpStatus ?? ""}\t${path}`;
  if (kind === "visualIssue") {
    return `visualIssue\t${c.finding.widgetRef ?? ""}\t${templatizePath(path).path}`;
  }
  const msg = c.finding.message.replace(/\s+/g, " ").trim();
  const harness = /^(locator\.|Timeout \d+ms exceeded)/i.test(msg);
  if (harness) return `${kind}\t${msg.split("(")[0]!.trim()}`;
  return `${kind}\t${msg}\t${path}`;
}

export type FindingCluster = { primary: FindingCase; copies: FindingCase[] };

export function collapseFindingCases(cases: FindingCase[]): FindingCluster[] {
  const byKey = new Map<string, FindingCluster>();
  const order: FindingCluster[] = [];
  for (const c of cases) {
    const key = findingFingerprint(c);
    const hit = byKey.get(key);
    if (hit) {
      hit.copies.push(c);
      continue;
    }
    const cluster = { primary: c, copies: [] as FindingCase[] };
    byKey.set(key, cluster);
    order.push(cluster);
  }
  return order;
}

export interface ReportMeta {
  url: string;
  generatedAt: string;
  runIds: string[];
  brain?: string;
  testability?: TestabilityReport;
  quality?: QualityReport;
  /** Per-page quality dump. Default is a rolled-up digest. */
  qualityFull?: boolean;
  outlines?: Array<{ runId: string; outline: UiExploreOutline }>;
  extra?: string;
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

function pathOfHref(href: string): string | undefined {
  try {
    const path = new URL(href).pathname;
    return path === "" ? "/" : path;
  } catch {
    return undefined;
  }
}

function renderCase(
  c: FindingCase,
  reportPath: string,
  extra?: { title?: string; expected?: string; actual?: string; why?: string },
  copies: FindingCase[] = [],
): string {
  const title = extra?.title || findingReportTitle(c.finding.kind, c.title || c.finding.message);
  const url = c.finding.url ?? c.url;
  const path = url ? pathOfHref(url) : undefined;
  const all = [c, ...copies];
  const runIds = [...new Set(all.map((x) => x.runId))];
  const pages = [...new Set(all.map((x) => x.pageId).filter(Boolean))];
  const lines = [
    `### ${title}`,
    "",
    `- **id:** ${c.id}`,
    `- **severity:** ${c.severity}`,
    `- **kind:** ${c.finding.kind}`,
  ];
  if (all.length > 1) {
    lines.push(`- **seen:** ${all.length}× in ${runIds.length} run${runIds.length === 1 ? "" : "s"}`);
    lines.push(`- **runs:** ${runIds.join(", ")}`);
  } else {
    lines.push(`- **run:** ${c.runId}`);
  }
  if (pages.length === 1) lines.push(`- **page:** ${pages[0]}`);
  else if (pages.length > 1) lines.push(`- **pages:** ${pages.join(", ")}`);
  if (url) lines.push(`- **url:** ${url}`);
  if (path) lines.push(`- **path:** ${path}`);
  lines.push("");
  if (extra?.expected) {
    lines.push(`**Expected:** ${extra.expected}`, "");
  }
  if (extra?.actual) {
    lines.push(`**Actual:** ${extra.actual}`, "");
  } else if (c.finding.kind === "pageError") {
    lines.push(pageErrorExplanation(c.finding.message), "");
  } else {
    lines.push(c.finding.message, "");
  }
  if (extra?.why) {
    lines.push(`**Why it matters:** ${extra.why}`, "");
  }
  const shot = shotMarkdown(c.screenshotPath, reportPath);
  if (shot) lines.push(shot, "");
  if (c.tape.trim()) {
    try {
      const log = parseLog(c.tape);
      if (!log.bug) log.bug = c.finding.message;
      lines.push(wrapClickmonkeyFence(log), "");
    } catch {
      lines.push("```clickmonkey", c.tape.trimEnd(), "```", "");
    }
  }
  if (copies.length > 0) {
    lines.push("**Also:**");
    for (const o of copies) {
      lines.push(`- ${o.runId} \`${o.id}\`${o.pageId ? ` · ${o.pageId}` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Wrap HTML tags in backticks so markdown/HTML viewers do not treat them as markup. */
export function markdownSafeQualityMessage(message: string): string {
  return message.replace(/<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s[^<>]*)?>/g, (tag) => `\`${tag}\``);
}

function formatIssueLine(i: QualityIssue | QualityRuntimeEvent): string {
  const times = i.count > 1 ? ` ×${i.count}` : "";
  const conf = "confidence" in i && i.confidence ? ` ${i.confidence}` : "";
  const where = "where" in i && i.where ? ` · ${i.where}` : "";
  return `- \`${i.rule}\` ${i.severity}${conf}${times}${where} — ${markdownSafeQualityMessage(i.message)}`;
}

export function isNoisyQualityMessage(message: string): boolean {
  const m = message.toLowerCase();
  if (m.includes("invalid keyframe")) return true;
  if (m.includes("preload") && (m.includes("not used") || m.includes("few seconds"))) return true;
  if (m.includes("does not conform to the required format") && m.includes("yyyy-mm-dd")) return true;
  return false;
}

function pageHasQuality(testability?: TestabilityPage, quality?: QualityPage): boolean {
  if (testability && testability.issues.length > 0) return true;
  if (!quality) return false;
  return qualityLedgerItems(quality).length > 0;
}

function qualityHeading(page: { path: string; origin?: string }): string {
  const path = templatizePath(page.path).path;
  return page.origin ? `${path} @ ${page.origin}` : path;
}

export function renderQualitySection(
  testability?: TestabilityReport,
  quality?: QualityReport,
): string[] {
  quality = quality ? applyDuplicateTitles(quality) : quality;
  const keys: Array<{ path: string; origin?: string }> = [];
  const add = (page: { path: string; origin?: string }) => {
    if (!keys.some((k) => sameLedgerPage(k, page))) keys.push({ path: page.path, origin: page.origin });
  };
  for (const p of testability?.pages ?? []) {
    if (p.issues.length > 0) add(p);
  }
  for (const p of quality?.pages ?? []) {
    if (qualityLedgerItems(p).length > 0) add(p);
  }
  if (keys.length === 0) return [];

  const lines = [
    "## Quality",
    "",
    "Recorded while walking — HTML (html-validate), accessibility (axe-core), testability, and JavaScript always; SEO (title/description/OG) on public paths; visual layout extras when a vision model ran.",
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
        const loc = i.where ? ` · ${i.where}` : "";
        lines.push(
          extra
            ? `- \`${i.code}\` ${i.severity} · ${i.tag} ${extra}${loc}`
            : `- \`${i.code}\` ${i.severity} · ${i.tag}${loc}`,
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
    if (q && (q.seo ?? []).length > 0) {
      lines.push("**SEO**", "");
      for (const i of q.seo) lines.push(formatIssueLine(i));
      lines.push("");
    }
    if (q && q.visual.length > 0) {
      lines.push("**Visual**", "");
      for (const i of q.visual) lines.push(formatIssueLine(i));
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

type DigestRow = {
  source: string;
  rule: string;
  severity: string;
  message: string;
  pages: number;
  count: number;
  pageSet: Set<string>;
  where?: string;
};

function digestKey(row: Pick<DigestRow, "source" | "rule" | "severity" | "message">): string {
  return `${row.source}\0${row.rule}\0${row.severity}\0${row.message}`;
}

function shortQualityMessage(message: string): string {
  let msg = message.replace(/\s+/g, " ").trim();
  if (msg.length > 120) {
    msg = msg.slice(0, 117);
    const lt = msg.lastIndexOf("<");
    const gt = msg.lastIndexOf(">");
    if (lt > gt) msg = msg.slice(0, lt).trimEnd();
    msg = `${msg}...`;
  }
  return markdownSafeQualityMessage(msg);
}

/** `rule` severity ×n — message. Omit ×n when listing under one page. */
function formatDigestIssue(row: DigestRow, underPage = false): string {
  const times = !underPage && row.count > 1 ? ` ×${row.count}` : "";
  const msg = shortQualityMessage(row.message);
  const loc = row.where ? ` · ${markdownSafeQualityMessage(row.where)}` : "";
  return msg
    ? `\`${row.rule}\` ${row.severity}${times} — ${msg}${loc}`
    : `\`${row.rule}\` ${row.severity}${times}${loc}`;
}

function wherePages(row: DigestRow): string {
  const names = [...row.pageSet].sort();
  if (names.length === 1) return `\`${names[0]}\``;
  if (names.length <= 5) return `${names.length} pages (${names.map((p) => `\`${p}\``).join(", ")})`;
  return `${names.length} pages (e.g. \`${names[0]}\`, \`${names[1]}\`)`;
}

const RULE_HINTS: Record<string, string> = {
  "color-contrast": "Theme or chrome colors — one token/CSS change.",
  "element-permitted-content":
    "Invalid nesting (block inside a button, or a tag in the wrong parent). Search the shell component that wraps those tags.",
  "aria-label-misuse": "aria-label on an element that does not support it — usually a wrapper in chrome.",
  missingStableId: "No stable id / data-testid. Later walks cannot target this control.",
  duplicateName: "Two widgets share the same accessible name.",
  clickableNonWidget: "Click handler on a non-interactive tag. Keyboard and screen-reader users cannot use it.",
  opaqueControl: "No accessible name. Add a visible label or aria-label.",
  "button-name": "Button has no discernible text (icon-only without a name).",
  "link-name": "Link has no discernible text (empty or icon-only).",
  "aria-hidden-focus": "aria-hidden node is still focusable — leftover overlay, or svg with tabindex.",
  "document-title": "This route never sets document.title.",
  "document-title-placeholder": "Title is still a framework default (Create Next App, Vite, …).",
  "document-title-long": "Title is longer than ~60 characters and will truncate in search results.",
  "document-title-same":
    "Every tab shows the same name. Set a unique document.title (and og:title) that names this page — screen readers announce it, and search uses it too.",
  "document-title-instance":
    "Different records on this route share one tab title. Put the record name in document.title (two customer tabs should not both say Customer).",
  "meta-description": "Add a unique meta description for search snippets and social fallback.",
  "og-title": "Open Graph title missing — shares will look untitled.",
  "og-description": "Open Graph description missing — shares get no summary.",
  "og-image": "Open Graph image missing — shares get no preview picture.",
  "og-url": "Open Graph url missing.",
  "canonical": "No rel=canonical — duplicates can split search ranking.",
  "element-required-content": "Required child missing (often head without title).",
  "attribute-allowed-values":
    "Invalid attribute value. React's default form action=javascript:... is framework, not copy.",
  "nested-interactive": "Interactive element nested inside another (button in a link).",
  "console.error": "JavaScript error or failed network request on this page.",
  "console.warning": "Runtime warning — read the message for the library that logged it.",
  pageError:
    "Uncaught JavaScript error (`pageerror`). Not console.error and not a validation message — the script crashed.",
};

type StartScope = "chrome" | "cluster" | "page";

function firstPathSegment(page: string): string | undefined {
  const path = page.replace(/ @ .*$/, "");
  return path.split("/").filter(Boolean)[0];
}

/** `/pipelines` when most pages in the set live under that first segment. */
export function pathFamily(pages: Iterable<string>): string | undefined {
  const names = [...pages];
  const counts = new Map<string, number>();
  for (const page of names) {
    const seg = firstPathSegment(page);
    if (!seg) continue;
    counts.set(seg, (counts.get(seg) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (!best || best[1] < 3) return undefined;
  if (best[1] / names.length < 0.6) return undefined;
  return `/${best[0]}`;
}

function formatStartItem(row: DigestRow, scope: StartScope): string {
  const family = scope === "cluster" ? pathFamily(row.pageSet) : undefined;
  const where =
    scope === "page"
      ? `\`${[...row.pageSet].sort()[0]}\``
      : family
        ? `${wherePages(row)}, mostly \`${family}\``
        : wherePages(row);
  const hint = RULE_HINTS[row.rule];
  const msg = shortQualityMessage(row.message);
  const scopeLabel =
    scope === "chrome" ? "shared shell" : scope === "cluster" ? "same component" : "this page only";
  const head = `Fix \`${row.rule}\` (${scopeLabel}, ${where})`;
  const detail: string[] = [];
  if (row.message.includes("<")) detail.push(msg.replace(/\.$/, ""));
  else if (!hint) detail.push(msg.replace(/\.$/, ""));
  if (row.where) detail.push(`Look at ${markdownSafeQualityMessage(row.where)}`);
  if (hint) detail.push(hint.replace(/\.$/, ""));
  return detail.length > 0 ? `${head} — ${detail.join(". ")}.` : head;
}

function rankStartClusters(clusters: DigestRow[]): DigestRow[] {
  return [...clusters].sort((a, b) => {
    const sev = Number(b.severity === "error") - Number(a.severity === "error");
    if (sev !== 0) return sev;
    const fa = pathFamily(a.pageSet) ? 1 : 0;
    const fb = pathFamily(b.pageSet) ? 1 : 0;
    if (fb !== fa) return fb - fa;
    if (b.pages !== a.pages) return b.pages - a.pages;
    return a.rule.localeCompare(b.rule) || a.message.localeCompare(b.message);
  });
}

function pickStartHere(
  chrome: DigestRow[],
  clusters: DigestRow[],
  uniqueRows: DigestRow[],
): Array<{ row: DigestRow; scope: StartScope }> {
  const out: Array<{ row: DigestRow; scope: StartScope }> = [];
  const seen = new Set<string>();
  const push = (row: DigestRow, scope: StartScope) => {
    const key = digestKey(row);
    if (seen.has(key) || out.length >= 3) return;
    seen.add(key);
    out.push({ row, scope });
  };
  const chromeErrors = chrome.filter((r) => r.severity === "error");
  const chromeWarns = chrome.filter((r) => r.severity !== "error");
  const hasLocal = clusters.length > 0 || uniqueRows.length > 0;
  const chromeSlots = hasLocal ? 2 : 3;
  for (const row of chromeErrors) {
    if (out.length >= chromeSlots) break;
    push(row, "chrome");
  }
  for (const row of chromeWarns) {
    if (out.length >= chromeSlots) break;
    push(row, "chrome");
  }
  for (const row of rankStartClusters(clusters)) push(row, "cluster");
  if (out.length < 3) {
    const topUnique = sortDigestRows(uniqueRows)[0];
    if (topUnique) push(topUnique, "page");
  }
  return out;
}

/** Shared shell: on most pages, or a third of a large walk (header logo, layout). */
export function isChromeRow(row: Pick<DigestRow, "pages">, pageCount: number): boolean {
  if (row.pages < 2 || pageCount < 2) return false;
  const share = row.pages / pageCount;
  if (share >= 0.5) return true;
  return pageCount >= 8 && share >= 1 / 3;
}

/** Same component on a few routes, not the whole shell. */
export function isClusterRow(row: Pick<DigestRow, "pages">, pageCount: number): boolean {
  return row.pages >= 3 && !isChromeRow(row, pageCount);
}

function sortDigestRows<T extends { severity: string; rule: string; message: string; pages?: number }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const sev = Number(b.severity === "error") - Number(a.severity === "error");
    if (sev !== 0) return sev;
    if (a.pages !== undefined && b.pages !== undefined && b.pages !== a.pages) return b.pages - a.pages;
    return a.rule.localeCompare(b.rule) || a.message.localeCompare(b.message);
  });
}

export function renderQualityDigest(
  testability?: TestabilityReport,
  quality?: QualityReport,
): string[] {
  quality = quality ? applyDuplicateTitles(quality) : quality;
  const byKey = new Map<string, DigestRow>();
  const add = (pageKey: string, row: Omit<DigestRow, "pages" | "pageSet">) => {
    if (row.severity === "warning" && isNoisyQualityMessage(row.message)) return;
    const key = digestKey(row);
    const prev = byKey.get(key);
    if (prev) {
      prev.count += row.count;
      prev.pageSet.add(pageKey);
      prev.pages = prev.pageSet.size;
      const where = joinWheres(prev.where, row.where);
      if (where) prev.where = where;
      return;
    }
    const pageSet = new Set([pageKey]);
    byKey.set(key, { ...row, pages: 1, pageSet });
  };

  for (const p of testability?.pages ?? []) {
    const pageKey = qualityHeading(p);
    for (const i of p.issues) {
      add(pageKey, {
        source: "testability",
        rule: i.code,
        severity: i.severity === "block" ? "error" : "warning",
        message: i.tag,
        count: 1,
        ...(i.where ? { where: i.where } : {}),
      });
    }
  }
  for (const p of quality?.pages ?? []) {
    const pageKey = qualityHeading(p);
    for (const i of qualityLedgerItems(p)) {
      add(pageKey, {
        source: i.source,
        rule: i.rule,
        severity: i.severity,
        message: i.message,
        count: i.count,
        ...("where" in i && i.where ? { where: i.where } : {}),
      });
    }
  }

  const rows = [...byKey.values()];
  if (rows.length === 0) return [];

  const pageCount = new Set(
    [...(testability?.pages ?? []), ...(quality?.pages ?? [])].map((p) => qualityHeading(p)),
  ).size;
  const chrome = sortDigestRows(rows.filter((r) => isChromeRow(r, pageCount)));
  const clusters = sortDigestRows(rows.filter((r) => isClusterRow(r, pageCount)));
  const uniqueRows = rows.filter((r) => !isChromeRow(r, pageCount) && !isClusterRow(r, pageCount));
  const pageScores = new Map<string, { errors: number; warnings: number }>();
  const bump = (page: string, severity: string) => {
    const cur = pageScores.get(page) ?? { errors: 0, warnings: 0 };
    if (severity === "error") cur.errors += 1;
    else cur.warnings += 1;
    pageScores.set(page, cur);
  };
  for (const row of uniqueRows) {
    for (const page of row.pageSet) bump(page, row.severity);
  }
  const topPages = [...pageScores.entries()]
    .filter(([, score]) => score.errors + score.warnings > 0)
    .sort((a, b) => b[1].errors - a[1].errors || b[1].warnings - a[1].warnings || a[0].localeCompare(b[0]))
    .slice(0, 8);

  const start = pickStartHere(chrome, clusters, uniqueRows);

  const lines = [
    "## Quality",
    "",
    `Workspace ledger across ${pageCount} page${pageCount === 1 ? "" : "s"}. **Start here** is what to fix first. Chrome is the shared shell — one change drops those counts everywhere. Issues on several pages are one component. Unique pages last. Console preload/keyframe warnings omitted. Use \`--quality-full\` for the long form.`,
    "",
  ];
  if (start.length > 0) {
    lines.push("### Start here", "");
    start.forEach((item, i) => {
      lines.push(`${i + 1}. ${formatStartItem(item.row, item.scope)}`);
    });
    lines.push("");
  }
  if (chrome.length > 0) {
    lines.push("### Chrome", "");
    for (const row of chrome) {
      lines.push(`- ${formatDigestIssue(row)} — ${wherePages(row)}`);
    }
    lines.push("");
  }
  if (clusters.length > 0) {
    lines.push("### On several pages", "");
    for (const row of clusters) {
      lines.push(`- ${formatDigestIssue(row)} — ${wherePages(row)}`);
    }
    lines.push("");
  }
  if (topPages.length > 0) {
    lines.push("### Pages with unique issues", "");
    for (const [page, score] of topPages) {
      lines.push(
        `- \`${page}\` — ${score.errors} error${score.errors === 1 ? "" : "s"}, ${score.warnings} warning${score.warnings === 1 ? "" : "s"}`,
      );
      const issues = sortDigestRows(uniqueRows.filter((r) => r.pageSet.has(page)));
      for (const row of issues) {
        lines.push(`  - ${formatDigestIssue(row, true)}`);
      }
    }
    lines.push("");
  }
  return lines;
}

export function outlinesFromRunDirs(runDirs: readonly string[]): Array<{ runId: string; outline: UiExploreOutline }> {
  const out: Array<{ runId: string; outline: UiExploreOutline }> = [];
  for (const dir of runDirs) {
    const presence = loadPresence(presencePath(dir));
    if (!presence?.outline) continue;
    out.push({ runId: dir.split(/[/\\]/).pop() ?? dir, outline: presence.outline });
  }
  return out;
}

function renderExploreOutlines(outlines: ReportMeta["outlines"]): string[] {
  if (!outlines || outlines.length === 0) return [];
  const lines = ["## Explore", ""];
  for (const { runId, outline } of outlines) {
    lines.push(`### ${runId}`, "", `**Charter:** ${outline.charter}`, "");
    if (outline.now) lines.push(`**Now:** ${outline.now}`, "");
    if (outline.plan) {
      lines.push(`**Plan:** ${outline.plan.goal}`, "");
      for (const item of outline.plan.items) lines.push(formatExplorePlanItemLine(item));
      lines.push("");
    }
    const goods = outline.goods ?? [];
    if (goods.length > 0) {
      lines.push("**Positive observations:**", "");
      for (const good of goods) lines.push(`- ${good}`);
      lines.push("");
    }
    if (outline.notes.length > 0) {
      lines.push("**Notes:**", "");
      for (const note of outline.notes) lines.push(`- ${note}`);
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
  const clusters = collapseFindingCases(cases);
  const counts = SEV_ORDER.map((s) => {
    const n = clusters.filter((g) => (g.primary.severity ?? severityForKind(g.primary.finding.kind)) === s).length;
    return n > 0 ? `${n} ${s}` : undefined;
  }).filter(Boolean);
  const qualityLines = meta.qualityFull
    ? renderQualitySection(meta.testability, meta.quality)
    : renderQualityDigest(meta.testability, meta.quality);
  const lines = [
    "# Findings report",
    "",
    "## Summary",
    "",
    summary?.trim() ||
      `${clusters.length} finding${clusters.length === 1 ? "" : "s"} from ${meta.runIds.length} run${meta.runIds.length === 1 ? "" : "s"} (${counts.join(", ") || "none"}).`,
    "",
    `- **url:** ${meta.url}`,
    `- **generated:** ${meta.generatedAt}`,
    `- **runs:** ${meta.runIds.join(", ") || "(none)"}`,
    ...(meta.brain ? [`- **brain:** ${meta.brain}`] : []),
    "",
    ...renderExploreOutlines(meta.outlines),
    "## Findings",
    "",
  ];
  const grouped = new Map<FindingSeverity, FindingCluster[]>();
  for (const sev of SEV_ORDER) grouped.set(sev, []);
  for (const g of clusters) {
    const sev = g.primary.severity ?? severityForKind(g.primary.finding.kind);
    grouped.get(sev)?.push(g);
  }
  for (const sev of SEV_ORDER) {
    const items = grouped.get(sev) ?? [];
    if (items.length === 0) continue;
    lines.push(`## ${sev[0]!.toUpperCase()}${sev.slice(1)}`, "");
    for (const g of items) {
      lines.push(renderCase(g.primary, reportPath, llm?.get(caseKey(g.primary)), g.copies), "");
    }
  }
  if (clusters.length === 0) {
    lines.push("_No findings in the selected runs._", "");
  }
  if (qualityLines.length > 0) {
    lines.push(...qualityLines);
  }
  const extra = meta.extra?.trim();
  if (extra) {
    lines.push("## Extra", "", extra, "");
  }
  lines.push("## Appendix", "", "Source finding folders live under each run's `findings/` directory.", "");
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

export type WrittenRunsReport = {
  id: string;
  dir: string;
  mdPath: string;
  findingCount: number;
  caseCount: number;
  cases: FindingCase[];
  meta: ReportMeta;
  extras?: Map<string, { title?: string; expected?: string; actual?: string; why?: string }>;
  summary?: string;
};

const HOST_TEXT_MAX = 8000;

function clipHostText(text: string | undefined): string | undefined {
  const one = text?.trim();
  if (!one) return undefined;
  if (one.length <= HOST_TEXT_MAX) return one;
  return `${one.slice(0, HOST_TEXT_MAX - 1)}…`;
}

/** Shared by `clickmonkey report` and MCP `explore_finish`. Skips the LLM unless `config.brain` is set. */
export async function writeRunsReport(opts: {
  configPath: string;
  config: Config;
  runDirs: string[];
  qualityFull?: boolean;
  onBrainError?: (message: string) => void;
  summary?: string;
  extra?: string;
  outlines?: Array<{ runId: string; outline: UiExploreOutline }>;
}): Promise<WrittenRunsReport> {
  const cases = collectFindingCases(opts.runDirs);
  const runIds = opts.runDirs.map((d) => d.split(/[/\\]/).pop() ?? d);
  const generatedAt = new Date().toISOString();
  const reportId = newRunId();
  const mdPath = plannedReportPath(opts.configPath, reportId);
  const hostSummary = clipHostText(opts.summary);
  const extra = clipHostText(opts.extra);
  let summary: string | undefined = hostSummary;
  let extras: Map<string, { title?: string; expected?: string; actual?: string; why?: string }> | undefined;
  if (opts.config.brain) {
    try {
      const enriched = await enrichWithBrain(cases, opts.config);
      if (!summary) summary = enriched.summary || undefined;
      extras = enriched.extras;
    } catch (err) {
      opts.onBrainError?.(err instanceof Error ? err.message : String(err));
    }
  }
  const outlines = opts.outlines?.length ? opts.outlines : outlinesFromRunDirs(opts.runDirs);
  const meta: ReportMeta = {
    url: opts.config.url,
    generatedAt,
    runIds,
    ...(opts.config.brain?.model ? { brain: opts.config.brain.model } : {}),
    testability: loadCombinedTestability(opts.runDirs, opts.configPath),
    quality: loadCombinedQuality(opts.runDirs, opts.configPath),
    ...(opts.qualityFull ? { qualityFull: true } : {}),
    ...(outlines.length > 0 ? { outlines } : {}),
    ...(extra ? { extra } : {}),
  };
  const markdown = renderFindingsReport(cases, meta, mdPath, extras, summary);
  const findingCount = collapseFindingCases(cases).length;
  const written = writeReportFolder(opts.configPath, {
    url: opts.config.url,
    generatedAt,
    runIds,
    findingCount,
    markdown,
    id: reportId,
  });
  return {
    id: written.id,
    dir: written.dir,
    mdPath: written.mdPath,
    findingCount,
    caseCount: cases.length,
    cases,
    meta,
    ...(extras ? { extras } : {}),
    ...(summary ? { summary } : {}),
  };
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
  let json: unknown;
  try {
    json = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { summary: "", extras };
  }
  const parsed = LlmItems.safeParse(json);
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
