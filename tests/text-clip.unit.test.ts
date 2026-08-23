import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CANDIDATE_SELECTOR,
  CLIP_HIGH_PX,
  CLIP_PX,
  MAX_HITS,
  SCANLINE_OWNED,
  clipConfidence,
  clipWhere,
  isCleanEllipsis,
  isWidthClipped,
  kindFromRoleTag,
  overflowClipsX,
  overflowIsScroll,
  scanlineOwnsNode,
  skipChromeBehindDialog,
  skipOpenMenu,
  textClipIssue,
  textClipMessage,
} from "../src/surveyor/text-clip.js";

describe("text-clip helpers", () => {
  it("uses the same clip thresholds as table scanline", () => {
    assert.equal(CLIP_PX, 4);
    assert.equal(CLIP_HIGH_PX, 12);
    assert.equal(MAX_HITS, 8);
    assert.equal(isWidthClipped(100, 100), false);
    assert.equal(isWidthClipped(104, 100), false);
    assert.equal(isWidthClipped(105, 100), true);
    assert.equal(clipConfidence(11), "medium");
    assert.equal(clipConfidence(12), "high");
  });

  it("does not invent clip on roomy boxes", () => {
    assert.equal(isWidthClipped(72, 72), false);
    assert.equal(isWidthClipped(72, 80), false);
  });

  it("names the control kind in the message", () => {
    assert.equal(textClipMessage("tab"), "Tab title is cut mid-word without an ellipsis");
    assert.equal(textClipMessage("button"), "Button label is cut mid-word without an ellipsis");
    assert.match(textClipMessage("chip"), /ellipsis/);
  });

  it("clips where to 40 characters", () => {
    assert.equal(clipWhere("Accounts receivable aging"), "Accounts receivable aging");
    const long = "A".repeat(50);
    const where = clipWhere(long);
    assert.equal(where.length, 40);
    assert.match(where, /…$/);
  });

  it("skips scanline-owned cells and fields", () => {
    assert.match(SCANLINE_OWNED, /\btd\b/);
    assert.match(SCANLINE_OWNED, /\bth\b/);
    assert.match(SCANLINE_OWNED, /role='cell'/);
    assert.match(SCANLINE_OWNED, /role='gridcell'/);
    assert.match(SCANLINE_OWNED, /\binput\b/);
    assert.match(SCANLINE_OWNED, /\btextarea\b/);
    assert.equal(scanlineOwnsNode({ tag: "td" }), true);
    assert.equal(scanlineOwnsNode({ tag: "th" }), true);
    assert.equal(scanlineOwnsNode({ role: "cell" }), true);
    assert.equal(scanlineOwnsNode({ role: "gridcell" }), true);
    assert.equal(scanlineOwnsNode({ tag: "input" }), true);
    assert.equal(scanlineOwnsNode({ tag: "textarea" }), true);
    assert.equal(scanlineOwnsNode({ tag: "div", role: "tab" }), false);
    assert.equal(scanlineOwnsNode({ tag: "button" }), false);
  });

  it("targets tabs, chips, headings, and toolbar labels — not tables", () => {
    assert.match(CANDIDATE_SELECTOR, /role='tab'/);
    assert.match(CANDIDATE_SELECTOR, /button/);
    assert.match(CANDIDATE_SELECTOR, /\ba\b/);
    assert.match(CANDIDATE_SELECTOR, /h1/);
    assert.match(CANDIDATE_SELECTOR, /chip/);
    assert.match(CANDIDATE_SELECTOR, /badge/);
    assert.match(CANDIDATE_SELECTOR, /menuitem/);
    assert.match(CANDIDATE_SELECTOR, /toolbar/);
    assert.doesNotMatch(CANDIDATE_SELECTOR, /\btd\b/);
    assert.doesNotMatch(CANDIDATE_SELECTOR, /\binput\b/);
  });

  it("skips clean ellipsis and line-clamp", () => {
    assert.equal(isCleanEllipsis({ textOverflow: "ellipsis" }), true);
    assert.equal(isCleanEllipsis({ textOverflow: "clip", webkitLineClamp: "2" }), true);
    assert.equal(isCleanEllipsis({ textOverflow: "clip" }, "Vendor statements…"), true);
    assert.equal(isCleanEllipsis({ textOverflow: "clip" }, "Accounts receivable aging"), false);
  });

  it("skips overflow auto/scroll and only clips hidden/clip", () => {
    assert.equal(overflowIsScroll("auto"), true);
    assert.equal(overflowIsScroll("scroll"), true);
    assert.equal(overflowIsScroll("hidden"), false);
    assert.equal(overflowClipsX("hidden"), true);
    assert.equal(overflowClipsX("clip"), true);
    assert.equal(overflowClipsX("visible"), false);
  });

  it("skips page chrome behind a small open dialog, not clips inside it", () => {
    assert.equal(
      skipChromeBehindDialog({ viewportWidth: 1280, dialogWidth: 400, insideDialog: false }),
      true,
    );
    assert.equal(
      skipChromeBehindDialog({ viewportWidth: 1280, dialogWidth: 400, insideDialog: true }),
      false,
    );
    assert.equal(
      skipChromeBehindDialog({ viewportWidth: 1280, dialogWidth: 1000, insideDialog: false }),
      false,
    );
    assert.equal(skipChromeBehindDialog({ viewportWidth: 1280, insideDialog: false }), false);
  });

  it("skips menuitems inside an open menu", () => {
    assert.equal(skipOpenMenu({ inMenu: true, menuShown: true }), true);
    assert.equal(skipOpenMenu({ inMenu: true, menuShown: false }), false);
    assert.equal(skipOpenMenu({ inMenu: false, menuShown: true }), false);
  });

  it("classifies role/tag into clip kinds", () => {
    assert.equal(kindFromRoleTag({ role: "tab", tag: "div" }), "tab");
    assert.equal(kindFromRoleTag({ tag: "button" }), "button");
    assert.equal(kindFromRoleTag({ tag: "a" }), "link");
    assert.equal(kindFromRoleTag({ tag: "h2" }), "heading");
    assert.equal(kindFromRoleTag({ className: "chip", role: "status" }), "chip");
    assert.equal(kindFromRoleTag({ className: "badge", role: "status" }), "badge");
    assert.equal(kindFromRoleTag({ role: "menuitem" }), "menuitem");
    assert.equal(kindFromRoleTag({ tag: "label", inToolbar: true }), "toolbar");
  });

  it("builds a visual clip issue", () => {
    const issue = textClipIssue({
      kind: "tab",
      where: "Accounts receivable aging",
      overflowPx: 40,
    });
    assert.equal(issue.source, "visual");
    assert.equal(issue.rule, "clip");
    assert.equal(issue.severity, "error");
    assert.equal(issue.count, 1);
    assert.equal(issue.confidence, "high");
    assert.equal(issue.where, "Accounts receivable aging");
    assert.equal(issue.message, "Tab title is cut mid-word without an ellipsis");
  });
});
