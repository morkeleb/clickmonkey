import type { Page } from "playwright";
import type { QualityIssue } from "../schema/quality.js";
import { scanOverflow } from "./overflow.js";
import { scanTextClip } from "./text-clip.js";

/** One class + one node so WCAG 1.4.12 teardown cannot miss a leftover sheet. */
export const STYLE_ID = "cm-text-spacing";
/** `*` — UA `button`/`input` reset letter-spacing, so html inheritance never reaches chips. */
export const TEXT_SPACING_CSS = `html.${STYLE_ID}, html.${STYLE_ID} * { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } html.${STYLE_ID} p { margin-bottom: 2em !important; }`;
export const TEXT_SPACING_CAP = 8;

const CONFIDENCE_RANK: Record<NonNullable<QualityIssue["confidence"]>, number> = {
  high: 2,
  medium: 1,
  low: 0,
};

const APPLY_SRC = `(() => {
  var id = ${JSON.stringify(STYLE_ID)};
  var css = ${JSON.stringify(TEXT_SPACING_CSS)};
  var style = document.getElementById(id);
  if (!style) {
    style = document.createElement("style");
    style.id = id;
    (document.head || document.documentElement).appendChild(style);
  }
  style.textContent = css;
  document.documentElement.classList.add(id);
})()`;

const RESTORE_SRC = `(() => {
  var id = ${JSON.stringify(STYLE_ID)};
  var style = document.getElementById(id);
  if (style && style.parentNode) style.parentNode.removeChild(style);
  document.documentElement.classList.remove(id);
})()`;

/** Prefix so reports are not mistaken for generic clip/overflow. */
export function textSpacingMessage(message: string): string {
  const one = String(message || "").replace(/\s+/g, " ").trim();
  if (/text spacing|WCAG 1\.4\.12/i.test(one)) return one;
  return `with text spacing: ${one}`;
}

export function tagTextSpacingIssue(issue: QualityIssue): QualityIssue {
  const next: QualityIssue = {
    source: issue.source,
    rule: "textSpacing",
    severity: issue.severity,
    message: textSpacingMessage(issue.message),
    count: issue.count,
  };
  if (issue.confidence) next.confidence = issue.confidence;
  if (issue.where) next.where = issue.where;
  return next;
}

/** High before medium; clip/overflow already cap at 8 each. */
export function takeTextSpacingHits(
  issues: QualityIssue[],
  max = TEXT_SPACING_CAP,
): QualityIssue[] {
  return issues
    .slice()
    .sort(
      (a, b) =>
        (CONFIDENCE_RANK[b.confidence ?? "low"] ?? 0) -
        (CONFIDENCE_RANK[a.confidence ?? "low"] ?? 0),
    )
    .slice(0, max);
}

const PAGE_WIDTH_OVERFLOW = /^Page is \d+px wider than the viewport/i;

/** Same clip/overflow under spacing is not a 1.4.12 failure. */
export function textSpacingBaselineKey(issue: Pick<QualityIssue, "rule" | "where" | "message">): string {
  const message = issue.message.replace(/\s+/g, " ").trim();
  // Document overflow `where` is the rightmost node and moves when letters space.
  if (issue.rule === "overflow" && PAGE_WIDTH_OVERFLOW.test(message)) {
    return "overflow\0page-width";
  }
  const where = (issue.where ?? "").replace(/\s+@ \d+px$/u, "").trim();
  if (where) return `${issue.rule}\0${where}`;
  return issue.rule;
}

export function onlyNewTextSpacingHits(
  spaced: QualityIssue[],
  baseline: readonly QualityIssue[] = [],
): QualityIssue[] {
  const keys = new Set(baseline.map(textSpacingBaselineKey));
  return spaced.filter((issue) => !keys.has(textSpacingBaselineKey(issue)));
}

/**
 * WCAG 1.4.12: page must survive user text spacing. Hits are clip/overflow
 * under the injected stylesheet, filed as textSpacing — not merged into those rules.
 * `baseline` is the unspaced clip/overflow set; only new hits are kept.
 */
export async function scanTextSpacing(
  page: Page,
  baseline: readonly QualityIssue[] = [],
): Promise<QualityIssue[]> {
  try {
    await page.evaluate(APPLY_SRC);
    const clip = await scanTextClip(page);
    const overflow = await scanOverflow(page);
    return takeTextSpacingHits(
      onlyNewTextSpacingHits([...clip, ...overflow], baseline).map((issue) =>
        tagTextSpacingIssue(issue),
      ),
    );
  } finally {
    await page.evaluate(RESTORE_SRC);
  }
}
