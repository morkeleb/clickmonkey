import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chapterOf, coverageLines, isOverflowAt320, splitOverflowByViewport, wcagOf } from "../src/reports/wcag.js";

describe("wcag map", () => {
  it("buckets axe, DOM, and layout rules into chapters", () => {
    assert.equal(chapterOf("color-contrast"), "accessibility");
    assert.equal(wcagOf("color-contrast").sc, "1.4.3");
    assert.equal(wcagOf("color-contrast").level, "AA");
    assert.equal(chapterOf("button-name"), "accessibility");
    assert.equal(chapterOf("nested-interactive"), "accessibility");
    assert.equal(chapterOf("aria-required-parent"), "accessibility");
    assert.equal(chapterOf("focusVisible"), "accessibility");
    assert.equal(chapterOf("focusObscured"), "accessibility");
    assert.equal(chapterOf("targetSize"), "accessibility");
    assert.equal(chapterOf("textSpacing"), "accessibility");
    assert.equal(chapterOf("overlap"), "visual");
    assert.equal(chapterOf("fontSize"), "visual");
    assert.equal(chapterOf("contrast"), "visual");
    assert.equal(chapterOf("no-dup-id"), "quality");
    assert.equal(chapterOf("duplicateName"), "testability");
    assert.equal(wcagOf("skip-link").sc, "2.4.1");
    assert.equal(wcagOf("label-content-name-mismatch").sc, "2.5.3");
    assert.equal(wcagOf("aria-dialog-name").sc, "4.1.2");
    assert.equal(wcagOf("heading-order").sc, undefined);
    assert.equal(wcagOf("tabindex").level, undefined);
    assert.equal(wcagOf("aria-roledescription").sc, "4.1.2");
    assert.equal(wcagOf("summary-name").sc, "4.1.2");
    assert.equal(wcagOf("table-fake-caption").sc, "1.3.1");
    assert.equal(wcagOf("td-has-header").sc, "1.3.1");
  });

  it("maps overflow at 320 to 1.4.10 and leaves 1280 in visual", () => {
    assert.equal(isOverflowAt320({ where: "main @ 320px" }), true);
    assert.equal(isOverflowAt320({ where: "main @ 375px" }), false);
    assert.equal(chapterOf("overflow", { where: "main @ 320px" }), "accessibility");
    assert.equal(wcagOf("overflow", { where: "main @ 320px" }).sc, "1.4.10");
    assert.equal(chapterOf("overflow", { where: "main @ 1280px" }), "visual");
    assert.equal(chapterOf("overflow", { message: "Page is 48px wider than the viewport" }), "visual");
    assert.equal(isOverflowAt320({ where: "header · main @ 320px · footer @ 375px" }), false);
    assert.equal(chapterOf("overflow", { where: "header · main @ 320px" }), "visual");
    const segs = splitOverflowByViewport("header · main @ 320px · footer @ 375px", "Page is 80px wider");
    assert.deepEqual(
      segs.map((s) => s.viewport).sort(),
      ["320", "other"],
    );
    assert.equal(chapterOf("overflow", { viewport: "320" }), "accessibility");
    assert.equal(chapterOf("overflow", { viewport: "other" }), "visual");
  });

  it("counts distinct mapped rules and ignores best-practice extras", () => {
    const lines = coverageLines([
      { rule: "color-contrast" },
      { rule: "color-contrast" },
      { rule: "button-name" },
      { rule: "heading-order" },
      { rule: "tabindex" },
      { rule: "focusVisible" },
      { rule: "overflow", extras: { where: "body @ 320px" } },
    ]);
    assert.match(lines.join("\n"), /Fails on covered SCs: A — 1 rule; AA — 3 rules\./);
    assert.match(lines.join("\n"), /Not checked: 3\.3\.8, 2\.5\.7, AAA/);
    assert.doesNotMatch(lines.join("\n"), /meets AA/i);
  });
});
