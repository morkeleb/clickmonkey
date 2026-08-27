import { dirname, relative } from "node:path";
import { z } from "zod";
import { chat, type ChatClient } from "../brains/chat.js";
import { isDismissed, loadDismissed } from "../persist/dismissed.js";
import { visualFindingKey } from "../persist/finding.js";
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
  severityForKind,
  type FindingSeverity,
} from "../schema/finding.js";
import { templatizePath } from "../surveyor/path-template.js";
import { applyDuplicateTitles } from "../surveyor/seo.js";
import { parseLog } from "../schema/dsl.js";
import type { QualityReport } from "../schema/quality.js";
import { joinWheres, qualityLedgerItems } from "../schema/quality.js";
import type { TestabilityReport } from "../schema/testability.js";
import { wrapClickmonkeyFence } from "./fences.js";
import { FINDINGS_SITE } from "./check-catalog.js";
import {
  chapterOf,
  compareSc,
  coverageLines,
  splitOverflowByViewport,
  type OverflowViewport,
  type ReportChapter,
} from "./wcag.js";
import { checkOf, type Check } from "./check.js";

const SEV_ORDER: FindingSeverity[] = ["critical", "major", "minor", "suggestion"];

/** Unique-to-a-route pages with their own issues shown in default reports. */
export const LEFTOVER_PAGE_CAP = 8;

const CHAPTER_HEADING: Record<ReportChapter, string> = {
  testability: "Testability",
  accessibility: "Accessibility",
  visual: "Visual",
  quality: "Quality",
};

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
  const rule = c.check.rule;
  const path = pathOfHref(c.finding.url ?? c.url ?? "") ?? "";
  if (rule === "notFound") return `notFound\t${path}`;
  if (rule === "httpError" || rule === "serverRefusedSubmit") {
    return `${rule}\t${c.finding.httpStatus ?? ""}\t${path}`;
  }
  if (c.finding.kind === "visualIssue") {
    return visualFindingKey(c.finding);
  }
  const msg = c.finding.message.replace(/\s+/g, " ").trim();
  const harness = /^(locator\.|Timeout \d+ms exceeded)/i.test(msg);
  if (harness) return `${rule}\t${msg.split("(")[0]!.trim()}`;
  return `${rule}\t${msg}\t${path}`;
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
  /** Uncap unique-to-a-route pages with their own issues. Same chapters either way. */
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

function expectedActual(c: FindingCase): { expected?: string; actual?: string } {
  const message = (c.message || c.finding.message).trim();
  const title = findingReportTitle(c.finding.kind, c.title || message).trim();
  const expected = (c.expected !== undefined ? c.expected : c.check.expected)?.trim() || undefined;
  const actual =
    (c.actual !== undefined ? c.actual.trim() : undefined) ||
    c.check.actual ||
    (expected ? message : message && message !== title ? message : undefined);
  return { expected, actual };
}

type ClassCatalog = {
  rows: Array<{ rule: string; chapter: ReportChapter; label?: string; pages: number }>;
};

function visualIssueWhere(message: string): { core: string; where?: string } {
  const idx = message.indexOf(" — ");
  if (idx < 0) return { core: message };
  return { core: message.slice(0, idx), where: message.slice(idx + 3) };
}

function checkLink(check: Check): string {
  return `[${check.title}](${check.href})`;
}

function seeClassLabel(c: FindingCase, catalog?: ClassCatalog): string | undefined {
  if (!catalog) return undefined;
  const rule = c.check.rule;
  const chapters: ReportChapter[] = [];
  if (rule === "overflow") {
    const { core, where } = visualIssueWhere(c.finding.message);
    const segs = splitOverflowByViewport(where, core);
    const viewports: OverflowViewport[] = [
      ...new Set(segs.map((s) => s.viewport)),
    ].sort((a, b) => Number(b === "320") - Number(a === "320"));
    for (const viewport of viewports) {
      const check = checkOf(rule, { source: "visual", message: core, where, viewport });
      if (check) chapters.push(check.chapter);
    }
  } else {
    chapters.push(c.check.chapter);
  }
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const chapter of chapters) {
    const hit = catalog.rows
      .filter((r) => r.rule === rule && r.chapter === chapter && r.label)
      .sort((a, b) => b.pages - a.pages)[0];
    if (hit?.label && !seen.has(hit.label)) {
      seen.add(hit.label);
      labels.push(`see ${hit.label}`);
    }
  }
  return labels.length > 0 ? labels.join(" · ") : undefined;
}

function renderCase(
  c: FindingCase,
  reportPath: string,
  extra?: { title?: string; expected?: string; actual?: string; why?: string },
  copies: FindingCase[] = [],
  catalog?: ClassCatalog,
): string {
  const title = extra?.title || findingReportTitle(c.finding.kind, c.title || c.finding.message);
  const url = c.finding.url ?? c.url;
  const path = url ? pathOfHref(url) : undefined;
  const all = [c, ...copies];
  const runIds = [...new Set(all.map((x) => x.runId))];
  const pages = [...new Set(all.map((x) => x.pageId).filter(Boolean))];
  const seen =
    all.length > 1 ? `${all.length}× in ${runIds.length} run${runIds.length === 1 ? "" : "s"}` : "";
  const pathBit = path && url ? `[${path}](${url})` : url ? url : undefined;
  const head = [pathBit, c.severity, seen || undefined].filter(Boolean).join(" · ");
  const canned = expectedActual(c);
  const expected = extra?.expected?.trim() || canned.expected;
  const actual = extra?.actual?.trim() || canned.actual;
  const check = c.check;
  const why = (extra?.why?.trim() || c.why || check.why).trim();
  const loc: string[] = [
    `\`${c.finding.kind}\` · ${c.severity}${seen ? ` · ${seen}` : ""} · \`${c.id}\``,
  ];
  if (runIds.length === 1) loc.push(`\`${runIds[0]}\``);
  else loc.push(runIds.map((id) => `\`${id}\``).join(" "));
  if (pages.length === 1) loc.push(`\`${pages[0]}\``);
  else if (pages.length > 1) loc.push(pages.map((id) => `\`${id}\``).join(" "));
  const lines = [`### ${title}`, ""];
  if (head) lines.push(head, "");
  if (expected) lines.push(`**Expected:** ${expected}`, "");
  if (actual) lines.push(`**Actual:** ${actual}`, "");
  if (why) {
    lines.push(`**Why it matters:** ${why} ${checkLink(check)}`, "");
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
    lines.push("Also seen:");
    for (const o of copies) {
      lines.push(`- ${o.runId} \`${o.id}\`${o.pageId ? ` · ${o.pageId}` : ""}`);
    }
    lines.push("");
  }
  const see = seeClassLabel(c, catalog);
  if (see) lines.push(see, "");
  lines.push(loc.join(" · "), "");
  return lines.join("\n");
}

/** Wrap HTML tags in backticks so markdown/HTML viewers do not treat them as markup. */
export function markdownSafeQualityMessage(message: string): string {
  return message.replace(/<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s[^<>]*)?>/g, (tag) => `\`${tag}\``);
}

export function isNoisyQualityMessage(message: string): boolean {
  const m = message.toLowerCase();
  if (m.includes("invalid keyframe")) return true;
  if (m.includes("preload") && (m.includes("not used") || m.includes("few seconds"))) return true;
  if (m.includes("does not conform to the required format") && m.includes("yyyy-mm-dd")) return true;
  return false;
}

function qualityHeading(page: { path: string; origin?: string }): string {
  const path = templatizePath(page.path).path;
  return page.origin ? `${path} @ ${page.origin}` : path;
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
  chapter: ReportChapter;
  label?: string;
  viewport?: OverflowViewport;
  check?: Check;
};

function digestKey(row: Pick<DigestRow, "source" | "rule" | "severity" | "message" | "viewport">): string {
  const vp = row.rule === "overflow" ? (row.viewport ?? "") : "";
  return `${row.source}\0${row.rule}\0${row.severity}\0${row.message}\0${vp}`;
}

function rowExtras(row: Pick<DigestRow, "message" | "where" | "source" | "viewport">) {
  return { message: row.message, where: row.where, source: row.source, viewport: row.viewport };
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

function shortWhere(where: string | undefined): string | undefined {
  if (!where?.trim()) return undefined;
  const parts = where
    .split(" · ")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return undefined;
  return markdownSafeQualityMessage(parts.join(" · "));
}

function pageCountTrail(row: Pick<DigestRow, "pages">): string {
  return `${row.pages} page${row.pages === 1 ? "" : "s"}`;
}

function formatLedgerRow(row: DigestRow, scope: StartScope, page?: string): string {
  const check = row.check ?? checkOf(row.rule, rowExtras(row));
  const bits = [row.label ? `**${row.label}**` : undefined];
  if (check?.level) bits.push(check.level);
  if (check?.sc && !row.label?.includes(check.sc)) bits.push(check.sc);
  bits.push(`\`${row.rule}\``);
  bits.push(row.severity);
  if (scope === "chrome") bits.push("chrome", pageCountTrail(row));
  else if (scope === "cluster") bits.push("cluster", pageCountTrail(row));
  else bits.push("page", page ? `\`${page}\`` : pageCountTrail(row));
  const head = `- ${bits.filter(Boolean).join(" · ")}`;
  const detail = [shortQualityMessage(row.message), shortWhere(row.where)].filter(Boolean).join(" · ");
  const lines = [head];
  if (detail) lines.push(`  ${detail}`);
  if (check) lines.push(`  Why it matters: ${check.why} ${checkLink(check)}`);
  return lines.join("\n");
}

function wherePages(row: DigestRow): string {
  const names = [...row.pageSet].sort();
  if (names.length === 1) return `\`${names[0]}\``;
  if (names.length <= 5) return `${names.length} pages (${names.map((p) => `\`${p}\``).join(", ")})`;
  return `${names.length} pages (e.g. \`${names[0]}\`, \`${names[1]}\`)`;
}

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
  const check = row.check ?? checkOf(row.rule, rowExtras(row));
  const msg = shortQualityMessage(row.message);
  const scopeLabel =
    scope === "chrome" ? "shared shell" : scope === "cluster" ? "same component" : "this page only";
  const head = `Fix \`${row.rule}\` (${scopeLabel}, ${where})`;
  const detail: string[] = [];
  if (row.message.includes("<")) detail.push(msg.replace(/\.$/, ""));
  else if (!check) detail.push(msg.replace(/\.$/, ""));
  if (row.where) detail.push(`Look at ${markdownSafeQualityMessage(row.where)}`);
  if (check) {
    detail.push(`${check.why.replace(/\.$/, "")} ${checkLink(check)}`);
  }
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

function sortA11yRows(rows: DigestRow[]): DigestRow[] {
  return [...rows].sort((a, b) => {
    const sc = compareSc(a.check?.sc, b.check?.sc);
    if (sc !== 0) return sc;
    const sev = Number(b.severity === "error") - Number(a.severity === "error");
    if (sev !== 0) return sev;
    if (b.pages !== a.pages) return b.pages - a.pages;
    return a.rule.localeCompare(b.rule) || a.message.localeCompare(b.message);
  });
}

function scGroupLabel(row: DigestRow): string {
  const check = row.check ?? checkOf(row.rule, rowExtras(row));
  if (check?.sc) {
    const title = check.scTitle && check.scTitle !== "Best practice" ? ` ${check.scTitle}` : "";
    const level = check.level ? ` (${check.level})` : "";
    return `${check.sc}${title}${level}`;
  }
  return check?.scTitle || "Best practice";
}

type Catalog = {
  rows: DigestRow[];
  pageCount: number;
  chrome: DigestRow[];
  clusters: DigestRow[];
  uniqueRows: DigestRow[];
  leftoverPages: string[];
  leftoverTotal: number;
  start: Array<{ row: DigestRow; scope: StartScope }>;
};

function collectDigestRows(
  testability?: TestabilityReport,
  quality?: QualityReport,
  findings?: FindingCase[],
): { rows: DigestRow[]; pageCount: number } {
  quality = quality ? applyDuplicateTitles(quality) : quality;
  const byKey = new Map<string, DigestRow>();
  const classify = (row: Pick<DigestRow, "rule" | "message" | "where" | "source" | "viewport">) => {
    const extras = rowExtras(row);
    const check = checkOf(row.rule, extras);
    return { check, chapter: check?.chapter ?? chapterOf(row.rule, extras), label: check?.title };
  };
  const add = (pageKey: string, row: Omit<DigestRow, "pages" | "pageSet" | "chapter" | "label" | "check">) => {
    if (row.severity === "warning" && isNoisyQualityMessage(row.message)) return;
    const { check, chapter, label } = classify(row);
    const keyed = { ...row, chapter, ...(check ? { check } : {}), ...(label ? { label } : {}) };
    const key = digestKey(keyed);
    const prev = byKey.get(key);
    if (prev) {
      prev.count += row.count;
      prev.pageSet.add(pageKey);
      prev.pages = prev.pageSet.size;
      const where = joinWheres(prev.where, row.where);
      if (where) prev.where = where;
      const next = classify(prev);
      prev.chapter = next.chapter;
      if (next.check) prev.check = next.check;
      if (next.label) prev.label = next.label;
      return;
    }
    const pageSet = new Set([pageKey]);
    byKey.set(key, { ...keyed, pages: 1, pageSet });
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
      const base = {
        source: i.source,
        rule: i.rule,
        severity: i.severity,
        message: i.message,
        count: i.count,
      };
      if (i.rule === "overflow") {
        const where = "where" in i ? i.where : undefined;
        for (const seg of splitOverflowByViewport(where, i.message)) {
          add(pageKey, {
            ...base,
            viewport: seg.viewport,
            ...(seg.where ? { where: seg.where } : {}),
          });
        }
        continue;
      }
      add(pageKey, {
        ...base,
        ...("where" in i && i.where ? { where: i.where } : {}),
      });
    }
  }
  for (const c of findings ?? []) {
    const rule = c.check.rule;
    // Finding cards already list the hit. Digest only when the oracle kind remapped
    // to a class (`expectFailed` → silentSubmit). visualIssue is on the quality ledger.
    if (c.finding.kind === "visualIssue" || rule === c.finding.kind) continue;
    const href = c.finding.url ?? c.url ?? "";
    const pageKey = pathOfHref(href) ?? c.pageId ?? c.finding.pageId ?? "/";
    add(pageKey, {
      source: c.check.chapter === "accessibility" ? "a11y" : "quality",
      rule,
      severity: "error",
      message: c.finding.message.split("\n")[0]!.trim(),
      count: 1,
      ...(c.finding.widgetRef ? { where: c.finding.widgetRef } : {}),
    });
  }

  const rows = [...byKey.values()];
  const pageCount = new Set([
    ...(testability?.pages ?? []).map((p) => qualityHeading(p)),
    ...(quality?.pages ?? []).map((p) => qualityHeading(p)),
    ...rows.flatMap((r) => [...r.pageSet]),
  ]).size;
  return { rows, pageCount };
}

function leftoverPageOrder(uniqueRows: DigestRow[]): string[] {
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
  return [...pageScores.entries()]
    .filter(([, score]) => score.errors + score.warnings > 0)
    .sort((a, b) => {
      const totalB = b[1].errors + b[1].warnings;
      const totalA = a[1].errors + a[1].warnings;
      if (totalB !== totalA) return totalB - totalA;
      if (b[1].errors !== a[1].errors) return b[1].errors - a[1].errors;
      return a[0].localeCompare(b[0]);
    })
    .map(([page]) => page);
}

function buildCatalog(
  testability?: TestabilityReport,
  quality?: QualityReport,
  leftoverCap = LEFTOVER_PAGE_CAP,
  findings?: FindingCase[],
): Catalog {
  const { rows, pageCount } = collectDigestRows(testability, quality, findings);
  const chrome = sortDigestRows(rows.filter((r) => isChromeRow(r, pageCount)));
  const clusters = sortDigestRows(rows.filter((r) => isClusterRow(r, pageCount)));
  const uniqueRows = rows.filter((r) => !isChromeRow(r, pageCount) && !isClusterRow(r, pageCount));
  const leftoverAll = leftoverPageOrder(uniqueRows);
  const leftoverPages = leftoverAll.slice(0, leftoverCap);
  return {
    rows,
    pageCount,
    chrome,
    clusters,
    uniqueRows,
    leftoverPages,
    leftoverTotal: leftoverAll.length,
    start: pickStartHere(chrome, clusters, uniqueRows),
  };
}

function emitLedgerRows(rows: DigestRow[], chapter: ReportChapter, scope: StartScope, page?: string): string[] {
  const sorted = chapter === "accessibility" ? sortA11yRows(rows) : sortDigestRows(rows);
  const lines: string[] = [];
  let lastGroup: string | undefined;
  for (const row of sorted) {
    if (chapter === "accessibility") {
      const group = scGroupLabel(row);
      if (group !== lastGroup) {
        if (lastGroup !== undefined) lines.push("");
        lines.push(`**${group}**`, "");
        lastGroup = group;
      }
    }
    lines.push(formatLedgerRow(row, scope, page));
  }
  return lines;
}

function renderChapter(
  chapter: ReportChapter,
  catalog: Catalog,
  opts?: { coverage?: boolean },
): string[] {
  const chrome = catalog.chrome.filter((r) => r.chapter === chapter);
  const clusters = catalog.clusters.filter((r) => r.chapter === chapter);
  const leftoverSet = new Set(catalog.leftoverPages);
  const leftoverPages = catalog.leftoverPages.filter((page) =>
    catalog.uniqueRows.some((r) => r.chapter === chapter && r.pageSet.has(page) && leftoverSet.has(page)),
  );
  if (chrome.length === 0 && clusters.length === 0 && leftoverPages.length === 0) return [];

  const lines = [`## ${CHAPTER_HEADING[chapter]}`, ""];
  if (opts?.coverage) {
    const a11yRows = catalog.rows.filter((r) => r.chapter === "accessibility");
    for (const line of coverageLines(a11yRows.map((r) => ({ rule: r.rule, extras: rowExtras(r) })))) {
      lines.push(line);
    }
    lines.push("");
  }
  if (chrome.length > 0) {
    lines.push("### Chrome", "");
    lines.push(...emitLedgerRows(chrome, chapter, "chrome"), "");
  }
  if (clusters.length > 0) {
    lines.push("### On several pages", "");
    lines.push(...emitLedgerRows(clusters, chapter, "cluster"), "");
  }
  if (leftoverPages.length > 0) {
    lines.push("### Pages", "");
    for (const page of leftoverPages) {
      lines.push(`#### \`${page}\``, "");
      const issues = catalog.uniqueRows.filter((r) => r.chapter === chapter && r.pageSet.has(page));
      lines.push(...emitLedgerRows(issues, chapter, "page", page), "");
    }
  }
  return lines;
}

function hasClassLabels(catalog: Catalog): boolean {
  return catalog.rows.some((r) => r.label);
}

function compareLabel(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

function issueCountTrail(n: number): string {
  return `${n} issue${n === 1 ? "" : "s"}`;
}

function pageLabels(catalog: Catalog, page: string): string[] {
  return catalog.rows
    .filter((r) => r.pageSet.has(page) && r.label)
    .map((r) => r.label!)
    .filter((v, i, all) => all.indexOf(v) === i)
    .sort(compareLabel);
}

function pagesByIssueCount(pages: readonly string[], catalog: Catalog): string[] {
  return [...pages].sort((a, b) => {
    const nb = pageLabels(catalog, b).length;
    const na = pageLabels(catalog, a).length;
    if (nb !== na) return nb - na;
    return a.localeCompare(b);
  });
}

type ChapterIssue = { label: string; rule: string; pages: Set<string>; row: DigestRow };

function chapterIssues(catalog: Catalog): Map<ReportChapter, ChapterIssue[]> {
  const byKey = new Map<string, ChapterIssue & { chapter: ReportChapter }>();
  for (const r of catalog.rows) {
    if (!r.label) continue;
    const key = `${r.chapter}\0${r.label}`;
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, { chapter: r.chapter, label: r.label, rule: r.rule, pages: new Set(r.pageSet), row: r });
      continue;
    }
    for (const page of r.pageSet) cur.pages.add(page);
  }
  const grouped = new Map<ReportChapter, ChapterIssue[]>();
  for (const item of byKey.values()) {
    const list = grouped.get(item.chapter) ?? [];
    list.push(item);
    grouped.set(item.chapter, list);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => b.pages.size - a.pages.size || compareLabel(a.label, b.label));
  }
  return grouped;
}

/**
 * Category → issue → pages. Compact enough for one printed page.
 * Page counts are the ledger, not collapsed finding cards.
 */
function renderChapterIssueIndex(catalog: Catalog): string[] {
  const grouped = chapterIssues(catalog);
  const body: string[] = [];
  for (const ch of ["testability", "accessibility", "visual", "quality"] as const) {
    const items = grouped.get(ch);
    if (!items?.length) continue;
    body.push(`- **${CHAPTER_HEADING[ch]}**`);
    for (const item of items) {
      const check = item.row.check ?? checkOf(item.rule, rowExtras(item.row));
      const tag = check ? checkLink(check) : item.label;
      body.push(`  - ${tag} — ${pageCountTrail({ pages: item.pages.size })}`);
    }
  }
  if (body.length === 0) return [];
  return [
    "### By chapter",
    "",
    `Pages affected per class. [Catalog](${FINDINGS_SITE}/findings/).`,
    "",
    ...body,
  ];
}

/** Issue index before Start here (or after an LLM paragraph). */
function withChapterIndex(summaryLines: string[], catalog: Catalog): string[] {
  const index = renderChapterIssueIndex(catalog);
  if (index.length === 0) return summaryLines;
  const startIdx = summaryLines.findIndex((l) => l === "### Start here");
  if (startIdx >= 0) {
    return [...summaryLines.slice(0, startIdx), ...index, "", ...summaryLines.slice(startIdx)];
  }
  return [...summaryLines, "", ...index];
}

function renderByPage(catalog: Catalog, qualityFull?: boolean): string[] {
  const raw = qualityFull
    ? [...new Set(catalog.rows.flatMap((r) => [...r.pageSet]))]
    : catalog.leftoverPages;
  const pages = pagesByIssueCount(raw, catalog);
  if (pages.length === 0) return [];
  const lines = ["## By page", ""];
  if (hasClassLabels(catalog)) {
    lines.push(
      "Same spec tags as in By chapter — jump to that class in the chapters above. Worst pages first.",
      "",
    );
  }
  for (const page of pages) {
    const labels = pageLabels(catalog, page);
    if (labels.length === 0) continue;
    lines.push(`- \`${page}\` — ${issueCountTrail(labels.length)} · ${labels.join(", ")}`);
  }
  if (lines.length === 2) return [];
  lines.push("");
  return lines;
}

function coverageForSummary(catalog: Catalog): string[] {
  const a11y = catalog.rows.filter((r) => r.chapter === "accessibility");
  if (a11y.length === 0) return [];
  return coverageLines(a11y.map((r) => ({ rule: r.rule, extras: rowExtras(r) })));
}

function countLine(
  clusters: FindingCluster[],
  runCount: number,
  catalog: Catalog,
  qualityFull?: boolean,
): string {
  const counts = SEV_ORDER.map((s) => {
    const n = clusters.filter((g) => (g.primary.severity ?? severityForKind(g.primary.finding.kind)) === s).length;
    return n > 0 ? `${n} ${s}` : undefined;
  }).filter(Boolean);
  const n = clusters.length;
  const findings = `${n} finding${n === 1 ? "" : "s"} from ${runCount} run${runCount === 1 ? "" : "s"} (${counts.join(", ") || "none"}).`;
  if (qualityFull || catalog.leftoverTotal <= LEFTOVER_PAGE_CAP) return findings;
  return `${findings} Showing the top ${LEFTOVER_PAGE_CAP} of ${catalog.leftoverTotal} pages with issues.`;
}

function fallbackSummary(
  clusters: FindingCluster[],
  catalog: Catalog,
  meta: ReportMeta,
): string[] {
  const lines = [countLine(clusters, meta.runIds.length, catalog, meta.qualityFull)];
  if (catalog.pageCount > 0) {
    lines[0] = `${lines[0]} Workspace ledger across ${catalog.pageCount} page${catalog.pageCount === 1 ? "" : "s"}.`;
  }
  const start = catalog.start;
  if (start.length > 0) {
    lines.push("", "### Start here", "");
    start.forEach((item, i) => {
      lines.push(`${i + 1}. ${formatStartItem(item.row, item.scope)}`);
    });
  } else if (clusters.length > 0) {
    lines.push("", "### Start here", "");
    clusters.slice(0, 3).forEach((g, i) => {
      const title = findingReportTitle(g.primary.finding.kind, g.primary.title || g.primary.finding.message);
      lines.push(`${i + 1}. ${title} (${g.primary.severity})`);
    });
  }
  const coverage = coverageForSummary(catalog);
  if (coverage.length > 0) {
    lines.push("", ...coverage);
  }
  return lines;
}

function renderCatalogChapters(catalog: Catalog, includeStartHere: boolean): string[] {
  if (catalog.rows.length === 0) return [];
  const lines: string[] = [];
  if (hasClassLabels(catalog)) {
    lines.push(...renderChapterIssueIndex(catalog), "");
  }
  if (includeStartHere && catalog.start.length > 0) {
    lines.push("### Start here", "");
    catalog.start.forEach((item, i) => {
      lines.push(`${i + 1}. ${formatStartItem(item.row, item.scope)}`);
    });
    lines.push("");
  }
  for (const chapter of ["testability", "accessibility", "visual", "quality"] as const) {
    lines.push(...renderChapter(chapter, catalog, { coverage: chapter === "accessibility" }));
  }
  return lines;
}

export function renderQualityDigest(
  testability?: TestabilityReport,
  quality?: QualityReport,
): string[] {
  const catalog = buildCatalog(testability, quality, LEFTOVER_PAGE_CAP);
  return renderCatalogChapters(catalog, true);
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
  const lines = ["### Explore", ""];
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
  const leftoverCap = meta.qualityFull ? Number.POSITIVE_INFINITY : LEFTOVER_PAGE_CAP;
  const catalog = buildCatalog(meta.testability, meta.quality, leftoverCap, cases);
  const summaryLines = withChapterIndex(
    summary?.trim() ? [summary.trim()] : fallbackSummary(clusters, catalog, meta),
    catalog,
  );
  const lines = [
    "# Findings report",
    "",
    "## Summary",
    "",
    ...summaryLines,
    "",
    `- **url:** ${meta.url}`,
    `- **generated:** ${meta.generatedAt}`,
    `- **runs:** ${meta.runIds.join(", ") || "(none)"}`,
    ...(meta.brain ? [`- **brain:** ${meta.brain}`] : []),
    "",
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
      lines.push(renderCase(g.primary, reportPath, llm?.get(caseKey(g.primary)), g.copies, catalog), "");
    }
  }
  if (clusters.length === 0) {
    lines.push("_No findings in the selected runs._", "");
  }
  for (const chapter of ["testability", "accessibility", "visual", "quality"] as const) {
    lines.push(...renderChapter(chapter, catalog, { coverage: chapter === "accessibility" }));
  }
  lines.push(...renderByPage(catalog, meta.qualityFull));
  const extra = meta.extra?.trim();
  if (extra) {
    lines.push("## Extra", "", extra, "");
  }
  lines.push("## Appendix", "", "Source finding folders live under each run's `findings/` directory.", "");
  lines.push(...renderExploreOutlines(meta.outlines));
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
  const dismissed = loadDismissed(opts.configPath);
  const cases = collectFindingCases(opts.runDirs).filter(
    (c) =>
      !isDismissed(dismissed, { id: c.id, runId: c.runId, fingerprint: findingFingerprint(c) }),
  );
  const runIds = opts.runDirs.map((d) => d.split(/[/\\]/).pop() ?? d);
  const generatedAt = new Date().toISOString();
  const reportId = newRunId();
  const mdPath = plannedReportPath(opts.configPath, reportId);
  const hostSummary = clipHostText(opts.summary);
  const extra = clipHostText(opts.extra);
  let summary: string | undefined = hostSummary;
  let extras: Map<string, { title?: string; expected?: string; actual?: string; why?: string }> | undefined;
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
  if (opts.config.brain) {
    try {
      const leftoverCap = opts.qualityFull ? Number.POSITIVE_INFINITY : LEFTOVER_PAGE_CAP;
      const catalog = buildCatalog(meta.testability, meta.quality, leftoverCap, cases);
      const digest = fallbackSummary(collapseFindingCases(cases), catalog, meta).join("\n");
      const enriched = await enrichWithBrain(cases, opts.config, chat, digest);
      if (!summary) summary = enriched.summary || undefined;
      extras = enriched.extras;
    } catch (err) {
      opts.onBrainError?.(err instanceof Error ? err.message : String(err));
    }
  }
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
  fallbackDigest?: string,
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
          'Reply with JSON only: { "summary": "...", "items": [{ "id", "title", "expected", "actual", "why" }] }.',
          "Use only the provided ids (runId/findingId). Do not invent reproduction steps.",
          "Title is one sentence stating the unexpected result, not \"area – action – unexpected result\".",
          "expected and actual are the contract versus what happened.",
          "why is this user or flow, not the class name.",
          "summary: 2–4 sentences from the supplied digest, start-here and highest severity first.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify({ digest: fallbackDigest ?? "", findings: digest }),
      },
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
