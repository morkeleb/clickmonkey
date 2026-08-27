import { z } from "zod";
import { ledgerPath } from "../surveyor/path-template.js";
import { sameLedgerPage } from "./testability.js";

export { sameLedgerPage };

export const QualitySource = z.enum(["html", "a11y", "seo", "console", "pageError", "visual"]);
export type QualitySource = z.infer<typeof QualitySource>;

export const QualitySeverity = z.enum(["error", "warning"]);
export type QualitySeverity = z.infer<typeof QualitySeverity>;

/** high/medium from DOM geometry or the vision model. Not a calibrated probability. */
export const QualityConfidence = z.enum(["high", "medium", "low"]);
export type QualityConfidence = z.infer<typeof QualityConfidence>;

export const QualityIssue = z
  .object({
    source: QualitySource,
    rule: z.string().min(1),
    severity: QualitySeverity,
    message: z.string().min(1),
    count: z.number().int().positive().default(1),
    /** Model-reported; optional. Visual extras only. */
    confidence: QualityConfidence.optional(),
    /** Short locator (testid / id / name / compacted CSS). Visual and scanners. */
    where: z.string().min(1).optional(),
    /** Who filed this visual issue. DOM wins when the same rule is merged. */
    via: z.enum(["dom", "vlm"]).optional(),
  });
export type QualityIssue = z.infer<typeof QualityIssue>;

export const QualityRuntimeEvent = z
  .object({
    source: z.enum(["console", "pageError"]),
    rule: z.string().min(1),
    severity: QualitySeverity,
    message: z.string().min(1),
    count: z.number().int().positive(),
    firstSeen: z.string().min(1),
    lastSeen: z.string().min(1),
  })
  .strict();
export type QualityRuntimeEvent = z.infer<typeof QualityRuntimeEvent>;

export const QualityPage = z
  .object({
    path: z.string().min(1),
    /** Set when the page is not on the leash origin. */
    origin: z.string().min(1).optional(),
    foundAt: z.string().min(1),
    htmlHash: z.string().min(1).optional(),
    /** Last PNG hash that produced `visual`. */
    visualHash: z.string().min(1).optional(),
    /** Last live `document.title`. Used at report time to catch one title on every page. */
    title: z.string().min(1).optional(),
    /** Live pathnames + titles for parametric pages (`/customers/:id1`). */
    titleInstances: z
      .array(z.object({ path: z.string().min(1), title: z.string().min(1) }).strict())
      .optional(),
    html: z.array(QualityIssue).default([]),
    a11y: z.array(QualityIssue).default([]),
    seo: z.array(QualityIssue).default([]),
    visual: z.array(QualityIssue).default([]),
    runtime: z.array(QualityRuntimeEvent).default([]),
  })
  .strict();
export type QualityPage = z.infer<typeof QualityPage>;

/** Per-run `quality.json` (HTML, a11y, visual, JS). Not the page map. */
export const QualityReport = z
  .object({
    schemaVersion: z.literal(1),
    pages: z.array(QualityPage).default([]),
  })
  .strict();
export type QualityReport = z.infer<typeof QualityReport>;

export function emptyQualityReport(): QualityReport {
  return { schemaVersion: 1, pages: [] };
}

export const MESSAGE_MAX = 400;
export const WHERE_MAX = 160;
const WHERE_EXAMPLES = 3;

/** Union up to three distinct `where` examples. */
export function joinWheres(existing: string | undefined, incoming: string | undefined): string | undefined {
  const parts = [
    ...new Set(
      [...(existing ? existing.split(" · ") : []), ...(incoming ? incoming.split(" · ") : [])]
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].slice(0, WHERE_EXAMPLES);
  if (parts.length === 0) return undefined;
  const joined = parts.join(" · ");
  return joined.length <= WHERE_MAX ? joined : `${joined.slice(0, WHERE_MAX - 1)}…`;
}

export function normalizeQualityMessage(message: string): string {
  const one = message.replace(/\s+/g, " ").trim();
  return one.length <= MESSAGE_MAX ? one : `${one.slice(0, MESSAGE_MAX - 1)}…`;
}

export function qualityIssueKey(
  i: Pick<QualityIssue, "source" | "rule" | "message"> & { via?: QualityIssue["via"] },
): string {
  if (i.source !== "visual") return `${i.source}\0${i.rule}\0${i.message}`;
  // DOM list/form/table scanlines are different defects; VLM prose for one class is not.
  if (i.rule === "scanline" && i.via === "dom") {
    return `${i.source}\0${i.rule}\0${normalizeQualityMessage(i.message)}`;
  }
  return `${i.source}\0${i.rule}`;
}

export function qualityIssuesEqual(
  a: readonly QualityIssue[] | undefined,
  b: readonly QualityIssue[] | undefined,
): boolean {
  const ka = [...(a ?? [])].map(qualityIssueKey).sort();
  const kb = [...(b ?? [])].map(qualityIssueKey).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
}

const CONFIDENCE_RANK: Record<QualityConfidence, number> = { low: 0, medium: 1, high: 2 };
const SEVERITY_RANK: Record<QualitySeverity, number> = { warning: 0, error: 1 };

/** Pixel-only visual rules. Geometry is DOM-owned; these survive replaceDom. */
export function isPixelVisualRule(rule: string): boolean {
  return rule === "contrast" || rule === "align" || rule === "other";
}

export function mergeQualityIssues(issues: QualityIssue[]): QualityIssue[] {
  const byKey = new Map<string, QualityIssue>();
  for (const i of issues) {
    const message = normalizeQualityMessage(i.message);
    const key = qualityIssueKey({ ...i, message });
    const prev = byKey.get(key);
    if (prev) {
      if (prev.via === "dom" && i.via === "vlm") {
        continue;
      }
      // Untagged is unknown, not DOM. VLM may refresh contrast/align/other only.
      if (!prev.via && i.via === "vlm" && !isPixelVisualRule(i.rule)) {
        continue;
      }
      prev.count += i.count;
      const where = joinWheres(prev.where, i.where);
      if (where) prev.where = where;
      if (i.via === "dom" && prev.via === "dom") {
        if (SEVERITY_RANK[i.severity] > SEVERITY_RANK[prev.severity]) {
          prev.severity = i.severity;
        }
        if (
          i.confidence &&
          CONFIDENCE_RANK[i.confidence] > CONFIDENCE_RANK[prev.confidence ?? "low"]
        ) {
          prev.confidence = i.confidence;
          prev.message = message;
        }
        continue;
      }
      if (i.via === "dom") {
        prev.message = message;
        prev.severity = i.severity;
        prev.via = "dom";
        if (i.confidence) prev.confidence = i.confidence;
        else delete prev.confidence;
        continue;
      }
      if (SEVERITY_RANK[i.severity] > SEVERITY_RANK[prev.severity]) {
        prev.severity = i.severity;
      }
      if (
        i.confidence &&
        CONFIDENCE_RANK[i.confidence] > CONFIDENCE_RANK[prev.confidence ?? "low"]
      ) {
        prev.confidence = i.confidence;
        prev.message = message;
      }
      continue;
    }
    byKey.set(key, { ...i, message, count: i.count });
  }
  return [...byKey.values()].sort((a, b) => qualityIssueKey(a).localeCompare(qualityIssueKey(b)));
}

export function mergeRuntimeEvents(
  existing: QualityRuntimeEvent[],
  incoming: QualityRuntimeEvent[],
): QualityRuntimeEvent[] {
  const byKey = new Map<string, QualityRuntimeEvent>();
  for (const e of existing) byKey.set(qualityIssueKey(e), { ...e });
  for (const e of incoming) {
    const message = normalizeQualityMessage(e.message);
    const key = qualityIssueKey({ ...e, message });
    const prev = byKey.get(key);
    if (prev) {
      prev.count += e.count;
      prev.lastSeen = e.lastSeen;
      continue;
    }
    byKey.set(key, { ...e, message });
  }
  return [...byKey.values()].sort((a, b) => qualityIssueKey(a).localeCompare(qualityIssueKey(b)));
}

function ledgerGroupKey(page: { path: string; origin?: string }): string {
  return `${page.origin ?? ""}\0${ledgerPath(page.path)}`;
}

export function mergeQualityPageGroup(pages: QualityPage[]): QualityPage {
  const first = pages[0]!;
  let foundAt = first.foundAt;
  let htmlHash: string | undefined;
  let visualHash: string | undefined;
  let title: string | undefined;
  let titleInstances: QualityPage["titleInstances"];
  let html: QualityIssue[] = [];
  let a11y: QualityIssue[] = [];
  let seo: QualityIssue[] = [];
  let visual: QualityIssue[] = [];
  let runtime: QualityRuntimeEvent[] = [];
  for (const p of pages) {
    if (p.foundAt < foundAt) foundAt = p.foundAt;
    if (p.htmlHash) htmlHash = p.htmlHash;
    if (p.visualHash) visualHash = p.visualHash;
    if (p.title?.trim()) title = p.title.replace(/\s+/g, " ").trim();
    titleInstances = mergeTitleInstances(titleInstances, p.titleInstances);
    html = mergeQualityIssues([...html, ...p.html]);
    a11y = mergeQualityIssues([...a11y, ...p.a11y]);
    seo = mergeQualityIssues([...seo, ...(p.seo ?? [])]);
    visual = mergeQualityIssues([...visual, ...p.visual]);
    runtime = mergeRuntimeEvents(runtime, p.runtime ?? []);
  }
  const next: QualityPage = {
    path: ledgerPath(first.path),
    foundAt,
    html,
    a11y,
    seo,
    visual,
    runtime,
  };
  if (first.origin) next.origin = first.origin;
  if (htmlHash) next.htmlHash = htmlHash;
  if (visualHash) next.visualHash = visualHash;
  if (title) next.title = title;
  if (titleInstances) next.titleInstances = titleInstances;
  return next;
}

export function foldQualityPages(pages: QualityPage[]): QualityPage[] {
  const groups = new Map<string, QualityPage[]>();
  for (const p of pages) {
    const key = ledgerGroupKey(p);
    const g = groups.get(key) ?? [];
    g.push(p);
    groups.set(key, g);
  }
  const out = [...groups.values()].map(mergeQualityPageGroup);
  out.sort((a, b) => {
    const o = (a.origin ?? "").localeCompare(b.origin ?? "");
    return o !== 0 ? o : a.path.localeCompare(b.path);
  });
  return out;
}

const TITLE_INSTANCES_MAX = 12;

export function mergeTitleInstances(
  existing: QualityPage["titleInstances"] | undefined,
  incoming: QualityPage["titleInstances"] | undefined,
): QualityPage["titleInstances"] {
  const byPath = new Map<string, { path: string; title: string }>();
  for (const i of [...(existing ?? []), ...(incoming ?? [])]) {
    const title = i.title.replace(/\s+/g, " ").trim();
    const path = i.path.trim();
    if (!title || !path) continue;
    byPath.set(path, { path, title });
  }
  const out = [...byPath.values()];
  if (out.length === 0) return undefined;
  return out.length <= TITLE_INSTANCES_MAX ? out : out.slice(out.length - TITLE_INSTANCES_MAX);
}

export function foldQualityReport(report: QualityReport): QualityReport {
  return { schemaVersion: 1, pages: foldQualityPages(report.pages) };
}

/** Union several run ledgers onto templated paths. */
export function combineQualityReports(reports: QualityReport[]): QualityReport {
  return foldQualityReport({
    schemaVersion: 1,
    pages: reports.flatMap((r) => r.pages),
  });
}

export function upsertQualityPage(report: QualityReport, page: QualityPage): QualityReport {
  const folded: QualityPage = { ...page, path: ledgerPath(page.path) };
  const pages = foldQualityPages(report.pages).filter((p) => !sameLedgerPage(p, folded));
  pages.push(folded);
  pages.sort((a, b) => {
    const o = (a.origin ?? "").localeCompare(b.origin ?? "");
    return o !== 0 ? o : a.path.localeCompare(b.path);
  });
  return { schemaVersion: 1, pages };
}

export function qualityLedgerItems(
  page: QualityPage,
): Array<QualityIssue | QualityRuntimeEvent> {
  return [...page.html, ...page.a11y, ...(page.seo ?? []), ...page.visual, ...page.runtime];
}

export function qualityPageCounts(page: QualityPage): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const i of qualityLedgerItems(page)) {
    if (i.severity === "error") errors += 1;
    else warnings += 1;
  }
  return { errors, warnings };
}
