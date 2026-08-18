import { z } from "zod";

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
  })
  .strict();
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

/** clickmonkey/testability.json — not the page map. */
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

export function dedupeIssues(issues: TestabilityIssue[]): TestabilityIssue[] {
  const seen = new Set<string>();
  const out: TestabilityIssue[] = [];
  for (const i of issues) {
    const k = issueKey(i);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(i);
  }
  return out.sort((a, b) => issueKey(a).localeCompare(issueKey(b)));
}

export function isInsufficient(issues: TestabilityIssue[]): boolean {
  return issues.some((i) => i.severity === "block");
}

export function sameLedgerPage(
  a: { path: string; origin?: string },
  b: { path: string; origin?: string },
): boolean {
  return a.path === b.path && (a.origin ?? "") === (b.origin ?? "");
}

export function upsertTestabilityPage(
  report: TestabilityReport,
  page: TestabilityPage,
): TestabilityReport {
  const pages = report.pages.filter((p) => !sameLedgerPage(p, page));
  pages.push(page);
  pages.sort((a, b) => {
    const o = (a.origin ?? "").localeCompare(b.origin ?? "");
    return o !== 0 ? o : a.path.localeCompare(b.path);
  });
  return { schemaVersion: 1, pages };
}
