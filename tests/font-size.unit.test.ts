import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHROME_SELECTOR,
  CODE_SELECTOR,
  FONT_SIZE_CAP,
  FONT_SIZE_HIGH_PX,
  FONT_SIZE_MIN_PX,
  TEXTISH_SELECTOR,
  fontSizeConfidence,
  fontSizeIssue,
  fontSizeMessage,
  isChromeLandmark,
  isCodeishTag,
  isEmptyText,
  isUndersizedFont,
  issuesFromFontSizeHits,
  parseFontSizePx,
  skipFontSizeNode,
  type FontSizeHit,
} from "../src/surveyor/font-size.js";

function hit(partial: Partial<FontSizeHit> & Pick<FontSizeHit, "px">): FontSizeHit {
  return { where: 'p[data-testid="tiny-copy"]', ...partial };
}

describe("fontSize thresholds", () => {
  it("flags CSS px under 12 and treats under 10 as high", () => {
    assert.equal(FONT_SIZE_MIN_PX, 12);
    assert.equal(FONT_SIZE_HIGH_PX, 10);
    assert.equal(FONT_SIZE_CAP, 8);
    assert.equal(isUndersizedFont(9), true);
    assert.equal(isUndersizedFont(11.9), true);
    assert.equal(isUndersizedFont(12), false);
    assert.equal(isUndersizedFont(16), false);
    assert.equal(fontSizeConfidence(9), "high");
    assert.equal(fontSizeConfidence(9.9), "high");
    assert.equal(fontSizeConfidence(10), "medium");
    assert.equal(fontSizeConfidence(11), "medium");
  });

  it("parses computed font-size as px", () => {
    assert.equal(parseFontSizePx("9px"), 9);
    assert.equal(parseFontSizePx("11.5px"), 11.5);
    assert.equal(Number.isFinite(parseFontSizePx("")), false);
  });
});

describe("fontSizeIssue", () => {
  it("flags 9px body copy as a high-confidence warning", () => {
    const issue = fontSizeIssue(hit({ px: 9 }));
    assert.ok(issue);
    assert.equal(issue.source, "visual");
    assert.equal(issue.rule, "fontSize");
    assert.equal(issue.severity, "warning");
    assert.equal(issue.confidence, "high");
    assert.equal(issue.count, 1);
    assert.equal(issue.where, 'p[data-testid="tiny-copy"]');
    assert.equal(issue.message, "Body text is 9px; keep body copy at least 12px");
  });

  it("flags 11px as medium and skips 12px", () => {
    const issue = fontSizeIssue(hit({ px: 11 }));
    assert.ok(issue);
    assert.equal(issue.confidence, "medium");
    assert.equal(issue.message, "Body text is 11px; keep body copy at least 12px");
    assert.equal(fontSizeIssue(hit({ px: 12 })), undefined);
    assert.equal(fontSizeIssue(hit({ px: 16 })), undefined);
  });

  it("skips incomplete hits", () => {
    assert.equal(fontSizeIssue(hit({ px: 9, where: "  " })), undefined);
    assert.equal(fontSizeIssue(hit({ px: Number.NaN })), undefined);
  });
});

describe("fontSize skips and grouping", () => {
  it("queries text-ish nodes and skips chrome plus code-ish tags", () => {
    assert.match(TEXTISH_SELECTOR, /\bp\b/);
    assert.match(TEXTISH_SELECTOR, /\bli\b/);
    assert.match(TEXTISH_SELECTOR, /\blabel\b/);
    assert.match(TEXTISH_SELECTOR, /\btd\b/);
    assert.match(TEXTISH_SELECTOR, /\bth\b/);
    assert.doesNotMatch(TEXTISH_SELECTOR, /\bbutton\b/);
    assert.doesNotMatch(TEXTISH_SELECTOR, /(^|,)\s*a\s*(,|$)/);
    assert.match(TEXTISH_SELECTOR, /\bh1\b/);
    assert.match(TEXTISH_SELECTOR, /role='heading'/);
    assert.match(CHROME_SELECTOR, /\bnav\b/);
    assert.match(CHROME_SELECTOR, /\baside\b/);
    assert.match(CHROME_SELECTOR, /\bfooter\b/);
    assert.match(CODE_SELECTOR, /\bcode\b/);
    assert.match(CODE_SELECTOR, /\bpre\b/);
    assert.match(CODE_SELECTOR, /\bkbd\b/);
    assert.match(CODE_SELECTOR, /\bsamp\b/);
    assert.equal(isChromeLandmark({ tag: "nav" }), true);
    assert.equal(isChromeLandmark({ tag: "aside" }), true);
    assert.equal(isChromeLandmark({ tag: "footer" }), true);
    assert.equal(isChromeLandmark({ role: "navigation" }), true);
    assert.equal(isChromeLandmark({ tag: "p" }), false);
    assert.equal(isCodeishTag("code"), true);
    assert.equal(isCodeishTag("pre"), true);
    assert.equal(isCodeishTag("p"), false);
    assert.equal(isEmptyText(""), true);
    assert.equal(isEmptyText("   "), true);
    assert.equal(isEmptyText("Body copy"), false);
    assert.equal(skipFontSizeNode({ hidden: true }), true);
    assert.equal(skipFontSizeNode({ zeroBox: true }), true);
    assert.equal(skipFontSizeNode({ ariaHidden: true }), true);
    assert.equal(skipFontSizeNode({ inert: true }), true);
    assert.equal(skipFontSizeNode({ chrome: true }), true);
    assert.equal(skipFontSizeNode({ code: true }), true);
    assert.equal(skipFontSizeNode({ emptyText: true }), true);
    assert.equal(skipFontSizeNode({}), false);
  });

  it("caps at 8 unique rounded px + where", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      hit({ px: 9, where: `p[data-testid="i${i}"]` }),
    );
    const issues = issuesFromFontSizeHits(many);
    assert.equal(issues.length, FONT_SIZE_CAP);
    const duped = issuesFromFontSizeHits([hit({ px: 9 }), hit({ px: 9 })]);
    assert.equal(duped.length, 1);
    const split = issuesFromFontSizeHits([
      hit({ px: 9, where: 'p[data-testid="a"]' }),
      hit({ px: 11, where: 'p[data-testid="a"]' }),
    ]);
    assert.equal(split.length, 2);
  });

  it("keeps the example message shape", () => {
    assert.equal(fontSizeMessage(9), "Body text is 9px; keep body copy at least 12px");
  });
});
