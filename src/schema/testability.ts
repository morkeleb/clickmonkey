import { z } from "zod";
import { ledgerPath } from "../surveyor/path-template.js";

export const TestabilityCode = z.enum([
  "opaqueControl",
  "clickableNonWidget",
  "unnamedDialog",
  "unlabeledField",
  "unnamedControl",
  "missingStableId",
  "noMain",
  "occludedWidget",
  "duplicateName",
]);
export type TestabilityCode = z.infer<typeof TestabilityCode>;

export const TestabilitySeverity = z.enum(["block", "warn"]);
export type TestabilitySeverity = z.infer<typeof TestabilitySeverity>;

export const TestabilityIssue = z
  .object({
    code: TestabilityCode,
    severity: TestabilitySeverity,
    tag: z.string().min(1),
    role: z.string().min(1).optional(),
    inputType: z.string().min(1).optional(),
    /** Short locator (name / testid / id / href). Same idea as quality `where`. */
    where: z.string().min(1).optional(),
  });
export type TestabilityIssue = z.infer<typeof TestabilityIssue>;

export const TestabilityPage = z
  .object({
    path: z.string().min(1),
    /** Set when the page is not on the leash origin. */
    origin: z.string().min(1).optional(),
    foundAt: z.string().min(1),
    insufficient: z.boolean(),
    issues: z.array(TestabilityIssue).default([]),
  })
  .strict();
export type TestabilityPage = z.infer<typeof TestabilityPage>;

/** Per-run `testability.json` — not the page map. */
export const TestabilityReport = z
  .object({
    schemaVersion: z.literal(1),
    pages: z.array(TestabilityPage).default([]),
  })
  .strict();
export type TestabilityReport = z.infer<typeof TestabilityReport>;

export function emptyTestabilityReport(): TestabilityReport {
  return { schemaVersion: 1, pages: [] };
}

export function issueKey(i: TestabilityIssue): string {
  return `${i.code}\0${i.tag}\0${i.role ?? ""}\0${i.inputType ?? ""}`;
}

const WHERE_EXAMPLES = 3;
const WHERE_MAX = 160;

function joinIssueWheres(existing: string | undefined, incoming: string | undefined): string | undefined {
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

export function dedupeIssues(issues: TestabilityIssue[]): TestabilityIssue[] {
  const byKey = new Map<string, TestabilityIssue>();
  for (const i of issues) {
    const k = issueKey(i);
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, { ...i });
      continue;
    }
    const where = joinIssueWheres(prev.where, i.where);
    if (where) prev.where = where;
  }
  return [...byKey.values()].sort((a, b) => issueKey(a).localeCompare(issueKey(b)));
}

export function isInsufficient(issues: TestabilityIssue[]): boolean {
  return issues.some((i) => i.severity === "block");
}

export function sameLedgerPage(
  a: { path: string; origin?: string },
  b: { path: string; origin?: string },
): boolean {
  return ledgerPath(a.path) === ledgerPath(b.path) && (a.origin ?? "") === (b.origin ?? "");
}

function ledgerGroupKey(page: { path: string; origin?: string }): string {
  return `${page.origin ?? ""}\0${ledgerPath(page.path)}`;
}

export function foldTestabilityPages(pages: TestabilityPage[]): TestabilityPage[] {
  const groups = new Map<string, TestabilityPage[]>();
  for (const p of pages) {
    const key = ledgerGroupKey(p);
    const g = groups.get(key) ?? [];
    g.push(p);
    groups.set(key, g);
  }
  const out: TestabilityPage[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.foundAt.localeCompare(b.foundAt));
    const last = sorted[sorted.length - 1]!;
    const next: TestabilityPage = {
      path: ledgerPath(last.path),
      foundAt: sorted[0]!.foundAt,
      insufficient: last.insufficient,
      issues: dedupeIssues(group.flatMap((p) => p.issues)),
    };
    if (last.origin) next.origin = last.origin;
    out.push(next);
  }
  out.sort((a, b) => {
    const o = (a.origin ?? "").localeCompare(b.origin ?? "");
    return o !== 0 ? o : a.path.localeCompare(b.path);
  });
  return out;
}

export function foldTestabilityReport(report: TestabilityReport): TestabilityReport {
  return { schemaVersion: 1, pages: foldTestabilityPages(report.pages) };
}

/** Union several run ledgers onto templated paths. */
export function combineTestabilityReports(reports: TestabilityReport[]): TestabilityReport {
  return foldTestabilityReport({
    schemaVersion: 1,
    pages: reports.flatMap((r) => r.pages),
  });
}

export function upsertTestabilityPage(
  report: TestabilityReport,
  page: TestabilityPage,
): TestabilityReport {
  const folded: TestabilityPage = { ...page, path: ledgerPath(page.path) };
  const pages = foldTestabilityPages(report.pages).filter((p) => !sameLedgerPage(p, folded));
  pages.push(folded);
  pages.sort((a, b) => {
    const o = (a.origin ?? "").localeCompare(b.origin ?? "");
    return o !== 0 ? o : a.path.localeCompare(b.path);
  });
  return { schemaVersion: 1, pages };
}
