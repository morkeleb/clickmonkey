import { z } from "zod";
import { sameLedgerPage } from "./testability.js";

export { sameLedgerPage };

export const QualitySource = z.enum(["html", "a11y", "console", "pageError"]);
export type QualitySource = z.infer<typeof QualitySource>;

export const QualitySeverity = z.enum(["error", "warning"]);
export type QualitySeverity = z.infer<typeof QualitySeverity>;

export const QualityIssue = z
  .object({
    source: QualitySource,
    rule: z.string().min(1),
    severity: QualitySeverity,
    message: z.string().min(1),
    count: z.number().int().positive().default(1),
  })
  .strict();
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
    html: z.array(QualityIssue).default([]),
    a11y: z.array(QualityIssue).default([]),
    runtime: z.array(QualityRuntimeEvent).default([]),
  })
  .strict();
export type QualityPage = z.infer<typeof QualityPage>;

/** clickmonkey/quality.json — HTML, a11y, JS. Not the page map. */
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

export function normalizeQualityMessage(message: string): string {
  const one = message.replace(/\s+/g, " ").trim();
  return one.length <= MESSAGE_MAX ? one : `${one.slice(0, MESSAGE_MAX - 1)}…`;
}

export function qualityIssueKey(i: Pick<QualityIssue, "source" | "rule" | "message">): string {
  return `${i.source}\0${i.rule}\0${i.message}`;
}

export function mergeQualityIssues(issues: QualityIssue[]): QualityIssue[] {
  const byKey = new Map<string, QualityIssue>();
  for (const i of issues) {
    const message = normalizeQualityMessage(i.message);
    const key = qualityIssueKey({ ...i, message });
    const prev = byKey.get(key);
    if (prev) {
      prev.count += i.count;
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

export function upsertQualityPage(report: QualityReport, page: QualityPage): QualityReport {
  const pages = report.pages.filter((p) => !sameLedgerPage(p, page));
  pages.push(page);
  pages.sort((a, b) => {
    const o = (a.origin ?? "").localeCompare(b.origin ?? "");
    return o !== 0 ? o : a.path.localeCompare(b.path);
  });
  return { schemaVersion: 1, pages };
}

export function qualityPageCounts(page: QualityPage): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const i of [...page.html, ...page.a11y, ...page.runtime]) {
    if (i.severity === "error") errors += 1;
    else warnings += 1;
  }
  return { errors, warnings };
}
