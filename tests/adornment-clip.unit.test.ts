import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLIP_HIGH_PX,
  CLIP_PX,
  HOST_SELECTOR,
  MAX_HITS,
  UA_ICON_TYPES,
  adornmentClipIssue,
  adornmentClipMessage,
  adornmentOverlapPx,
  clipConfidence,
  clipSeverity,
  clipWhere,
  isAdornmentClip,
  isCleanEllipsis,
  isFieldChromeClass,
  isSuffixGlyph,
  isTrailingAdornment,
  issuesFromAdornmentHits,
  overflowIsScroll,
  skipAdornmentHost,
  skipUaInputType,
  type AdornmentClipHit,
} from "../src/surveyor/adornment-clip.js";

const box = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

describe("adornment-clip geometry", () => {
  it("overlap ≥4 flags, 3px gap does not, high at 12px, skip when no overlap", () => {
    const text = box(0, 0, 100, 20);
    const overlap4 = box(96, 0, 20, 20);
    assert.equal(adornmentOverlapPx(text, overlap4), 4);
    assert.equal(isAdornmentClip(4), true);
    const flagged = adornmentClipIssue({ where: "100.00%", overlapPx: 4 });
    assert.ok(flagged);
    assert.equal(flagged.rule, "clip");
    assert.equal(flagged.source, "visual");
    assert.equal(flagged.confidence, "medium");
    assert.equal(flagged.severity, "warning");

    const gapped = box(103, 0, 20, 20);
    assert.equal(adornmentOverlapPx(text, gapped), 0);
    assert.equal(isAdornmentClip(adornmentOverlapPx(text, gapped)), false);
    assert.equal(adornmentClipIssue({ where: "100.00%", overlapPx: 0 }), undefined);

    const overlap12 = box(88, 0, 20, 20);
    assert.equal(adornmentOverlapPx(text, overlap12), 12);
    assert.equal(clipConfidence(12), "high");
    assert.equal(clipSeverity(12), "error");
    const high = adornmentClipIssue({ where: "100.00%", overlapPx: 12 });
    assert.ok(high);
    assert.equal(high.confidence, "high");
    assert.equal(high.severity, "error");

    const apart = box(200, 0, 20, 20);
    assert.equal(adornmentOverlapPx(text, apart), 0);
    assert.equal(adornmentClipIssue({ where: "x", overlapPx: 0 }), undefined);
    assert.equal(adornmentClipIssue({ where: "x", overlapPx: 3 }), undefined);
    assert.equal(CLIP_PX, 4);
    assert.equal(CLIP_HIGH_PX, 12);
    assert.equal(MAX_HITS, 8);
  });

  it("requires overlap on both axes", () => {
    const text = box(0, 0, 100, 20);
    const beside = box(96, 24, 20, 20);
    assert.equal(adornmentOverlapPx(text, beside), 0);
    const justY = box(96, 17, 20, 20);
    assert.equal(adornmentOverlapPx(text, justY), 3);
    assert.equal(isAdornmentClip(3), false);
  });
});

describe("adornment-clip skips and hosts", () => {
  it("targets fields, comboboxes, and tabs — not buttons or checkboxes", () => {
    assert.match(HOST_SELECTOR, /\binput:not\(\[type='hidden'\]\)/);
    assert.match(HOST_SELECTOR, /\btextarea\b/);
    assert.match(HOST_SELECTOR, /role='combobox'/);
    assert.match(HOST_SELECTOR, /role='tab'/);
    assert.match(HOST_SELECTOR, /:not\(\[type='checkbox'\]\)/);
    assert.match(HOST_SELECTOR, /:not\(\[type='button'\]\)/);
  });

  it("skips native date/color/range UA icons, not type=text", () => {
    assert.deepEqual([...UA_ICON_TYPES], ["date", "color", "range"]);
    assert.equal(skipUaInputType("date"), true);
    assert.equal(skipUaInputType("color"), true);
    assert.equal(skipUaInputType("range"), true);
    assert.equal(skipUaInputType("text"), false);
    assert.equal(skipUaInputType("search"), false);
  });

  it("treats only right-side nodes as trailing adornments", () => {
    const host = box(0, 0, 100, 32);
    assert.equal(isTrailingAdornment(host, box(50, 4, 16, 16)), true);
    assert.equal(isTrailingAdornment(host, box(41, 4, 16, 16)), true);
    assert.equal(isTrailingAdornment(host, box(40, 4, 16, 16)), false);
    assert.equal(isTrailingAdornment(host, box(8, 4, 16, 16)), false);
  });

  it("accepts % / $ / currency-like glyphs as suffix icons", () => {
    assert.equal(isSuffixGlyph("%"), true);
    assert.equal(isSuffixGlyph("$"), true);
    assert.equal(isSuffixGlyph(" € "), true);
    assert.equal(isSuffixGlyph("USD"), false);
    assert.equal(isSuffixGlyph("100"), false);
    assert.equal(isSuffixGlyph("xy"), false);
  });

  it("detects outlined+input / text+field / input+root chrome class tokens", () => {
    assert.equal(isFieldChromeClass("outlined-input"), true);
    assert.equal(isFieldChromeClass("mdc-text-field"), true);
    assert.equal(isFieldChromeClass("input-root"), true);
    assert.equal(isFieldChromeClass("MuiOutlinedInput-root"), true);
    assert.equal(isFieldChromeClass("btn-icon"), false);
  });

  it("skips disabled, hidden, chrome fields, menus, ellipsis, and overflow scroll", () => {
    assert.equal(skipAdornmentHost({ shown: false }), true);
    assert.equal(skipAdornmentHost({ disabled: true }), true);
    assert.equal(skipAdornmentHost({ ariaHidden: true }), true);
    assert.equal(skipAdornmentHost({ inMenu: true }), true);
    assert.equal(skipAdornmentHost({ inListbox: true }), true);
    assert.equal(skipAdornmentHost({ inChrome: true, role: "textbox", type: "text" }), true);
    assert.equal(skipAdornmentHost({ inChrome: true, role: "tab" }), false);
    assert.equal(skipAdornmentHost({ type: "date" }), true);
    assert.equal(skipAdornmentHost({ overflowX: "auto" }), true);
    assert.equal(skipAdornmentHost({ ellipsis: true }), true);
    assert.equal(skipAdornmentHost({ shown: true, type: "text" }), false);
    assert.equal(overflowIsScroll("scroll"), true);
    assert.equal(overflowIsScroll("hidden"), false);
    assert.equal(isCleanEllipsis({ textOverflow: "ellipsis" }), true);
    assert.equal(isCleanEllipsis({ textOverflow: "clip" }, "Profitability"), false);
  });
});

describe("adornmentClipIssue", () => {
  it("names tab titles vs field values", () => {
    assert.equal(adornmentClipMessage("tab"), "Tab title collides with a trailing icon");
    assert.equal(adornmentClipMessage("value"), "Value collides with a trailing icon");
    const tab = adornmentClipIssue({
      kind: "tab",
      where: "Profitability",
      overlapPx: 16,
    });
    assert.ok(tab);
    assert.equal(tab.source, "visual");
    assert.equal(tab.rule, "clip");
    assert.equal(tab.severity, "error");
    assert.equal(tab.count, 1);
    assert.equal(tab.where, "Profitability");
    assert.equal(tab.message, "Tab title collides with a trailing icon");
    const value = adornmentClipIssue({
      kind: "value",
      where: "100.00%",
      overlapPx: 8,
    });
    assert.ok(value);
    assert.equal(value.message, "Value collides with a trailing icon");
    assert.equal(value.severity, "warning");
    assert.equal(value.confidence, "medium");
  });

  it("clips where to 40 characters and skips empty", () => {
    assert.equal(clipWhere("Profitability"), "Profitability");
    const long = "A".repeat(50);
    const where = clipWhere(long);
    assert.equal(where.length, 40);
    assert.match(where, /…$/);
    assert.equal(adornmentClipIssue({ where: "  ", overlapPx: 16 }), undefined);
  });

  it("caps at 8 and drops duplicate where+message", () => {
    const many: AdornmentClipHit[] = Array.from({ length: 12 }, (_, i) => ({
      kind: "value",
      where: `v${i}`,
      overlapPx: 16,
    }));
    const issues = issuesFromAdornmentHits(many);
    assert.equal(issues.length, MAX_HITS);
    const duped = issuesFromAdornmentHits([
      { kind: "value", where: "100.00%", overlapPx: 16 },
      { kind: "value", where: "100.00%", overlapPx: 20 },
    ]);
    assert.equal(duped.length, 1);
  });
});
