import { checkOf } from "./check.js";
import type { ChapterExtras, ReportChapter } from "./wcag.js";

export type LabelInput = {
  chapter: ReportChapter;
  severity: string;
  pages: number;
  rule: string;
  message?: string;
  where?: string;
  viewport?: import("./wcag.js").OverflowViewport;
  key: string;
};

function extrasOf(row: LabelInput): ChapterExtras {
  return {
    ...(row.message ? { message: row.message } : {}),
    ...(row.where ? { where: row.where } : {}),
    ...(row.viewport ? { viewport: row.viewport } : {}),
    source: row.chapter === "accessibility" ? "a11y" : row.chapter === "visual" ? "visual" : row.chapter,
  };
}

/** WCAG / HTML / catalog title for a digest row. Catalog ids stay on GitHub Pages. */
export function classLabelFor(row: LabelInput): string {
  return checkOf(row.rule, extrasOf(row))?.title ?? row.rule;
}

/** Markdown for the findings report: spec names, not T-01 / Q-1. */
export function labelLegendLines(): string[] {
  return [
    "### Labels",
    "",
    "Issues are tagged by **spec name**: WCAG success criteria, HTML authoring (html-validate or the HTML spec), or ClickMonkey catalog titles ([catalog](https://morkeleb.github.io/clickmonkey/findings/)). The list is pages affected — fixing one class can clear many routes.",
  ];
}

export function assignClassLabels(rows: readonly LabelInput[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    if (out.has(row.key)) continue;
    out.set(row.key, classLabelFor(row));
  }
  return out;
}
