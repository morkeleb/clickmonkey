import type { ReportChapter } from "./wcag.js";

export type LabelClass = "T" | "A" | "V" | "Q";

export type LabelInput = {
  chapter: ReportChapter;
  severity: string;
  pages: number;
  rule: string;
  message?: string;
  key: string;
};

const PREFIX: Record<ReportChapter, LabelClass> = {
  testability: "T",
  accessibility: "A",
  visual: "V",
  quality: "Q",
};

function isError(severity: string): boolean {
  return severity === "error" || severity === "block" || severity === "critical";
}

export function assignClassLabels(rows: readonly LabelInput[]): Map<string, string> {
  const buckets = new Map<LabelClass, LabelInput[]>();
  for (const row of rows) {
    const prefix = PREFIX[row.chapter];
    const list = buckets.get(prefix) ?? [];
    list.push(row);
    buckets.set(prefix, list);
  }
  const out = new Map<string, string>();
  for (const prefix of ["T", "A", "V", "Q"] as const) {
    const list = buckets.get(prefix);
    if (!list?.length) continue;
    list.sort((a, b) => {
      const sev = Number(isError(b.severity)) - Number(isError(a.severity));
      if (sev !== 0) return sev;
      if (b.pages !== a.pages) return b.pages - a.pages;
      const rule = a.rule.localeCompare(b.rule);
      if (rule !== 0) return rule;
      return (a.message ?? "").localeCompare(b.message ?? "");
    });
    let n = 1;
    for (const row of list) {
      if (out.has(row.key)) continue;
      out.set(row.key, `${prefix}-${n}`);
      n += 1;
    }
  }
  return out;
}
