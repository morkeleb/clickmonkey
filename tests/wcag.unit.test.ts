import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHAPTER_ORDER,
  chapterOf,
  coverageLines,
  isAxeRule,
  isEnabledAxeRule,
  isOverflowAt320,
  isAcceptedInvalidFinding,
  isServerRefusedSubmitFinding,
  isSilentSubmitFinding,
  isThrowInsteadOfInvalidFinding,
  splitOverflowByViewport,
  wcagOf,
} from "../src/reports/wcag.js";

describe("wcag map", () => {
  it("orders report chapters Quality → Visual → Accessibility → Testability", () => {
    assert.deepEqual([...CHAPTER_ORDER], ["quality", "visual", "accessibility", "testability"]);
  });

  it("buckets axe, DOM, and layout rules into chapters", () => {
    assert.equal(isAxeRule("color-contrast"), true);
    assert.equal(isAxeRule("tabindex"), true);
    assert.equal(isAxeRule("skip-link"), true);
    assert.equal(isEnabledAxeRule("color-contrast"), true);
    assert.equal(isEnabledAxeRule("label-content-name-mismatch"), true);
    assert.equal(isEnabledAxeRule("css-orientation-lock"), false);
    assert.equal(isEnabledAxeRule("audio-caption"), false);
    assert.equal(isAxeRule("clickableNonWidget"), false);
    assert.equal(isAxeRule("focusVisible"), false);
    assert.equal(isAxeRule("overlap"), false);
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
    assert.equal(chapterOf("clickableNonWidget"), "accessibility");
    assert.equal(wcagOf("clickableNonWidget").sc, "2.1.1");
    assert.equal(wcagOf("clickableNonWidget").level, "A");
    assert.equal(wcagOf("keyboardTrap").sc, "2.1.2");
    assert.equal(wcagOf("focusOrder").sc, "2.4.3");
    assert.equal(wcagOf("skip-link").sc, "2.4.1");
    assert.equal(wcagOf("label-content-name-mismatch").sc, "2.5.3");
    assert.equal(wcagOf("aria-dialog-name").sc, "4.1.2");
    assert.equal(wcagOf("heading-order").sc, undefined);
    assert.equal(wcagOf("tabindex").level, undefined);
    assert.equal(wcagOf("aria-roledescription").sc, "4.1.2");
    assert.equal(wcagOf("summary-name").sc, "4.1.2");
    assert.equal(wcagOf("table-fake-caption").sc, "1.3.1");
    assert.equal(wcagOf("td-has-header").sc, "1.3.1");
    const silent =
      "Save did not submit the form: no navigation, no write request, and no invalid fields were shown";
    assert.equal(isSilentSubmitFinding(silent), true);
    assert.equal(chapterOf("expectFailed", { message: silent }), "accessibility");
    assert.equal(wcagOf("expectFailed", { message: silent }).sc, "3.3.1");
    assert.equal(wcagOf("expectFailed", { message: silent }).level, "A");
    assert.equal(wcagOf("expectFailed", { message: silent }).title, "Error Identification");
    assert.equal(wcagOf("silentSubmit").sc, "3.3.1");
    assert.equal(chapterOf("expectFailed"), "quality");
    const refused = "HTTP 409 POST https://app/api/vouchers: Vendor has status Blacklisted";
    assert.equal(isServerRefusedSubmitFinding(refused), true);
    assert.equal(isServerRefusedSubmitFinding("HTTP 400 GET https://app/api/vouchers"), false);
    assert.equal(isServerRefusedSubmitFinding("HTTP 403 POST https://app/api/vouchers"), false);
    assert.equal(chapterOf("serverRefusedSubmit"), "quality");
    assert.equal(chapterOf("httpError", { message: refused }), "quality");
    assert.equal(wcagOf("serverRefusedSubmit").sc, undefined);
    const empty = "Required field `page.name` accepted empty";
    const junk = "Validation did not catch junk in `page.email`";
    assert.equal(isAcceptedInvalidFinding(empty), true);
    assert.equal(isAcceptedInvalidFinding(junk), true);
    assert.equal(isAcceptedInvalidFinding(silent), false);
    assert.equal(chapterOf("acceptedInvalid"), "quality");
    assert.equal(chapterOf("expectFailed", { message: empty }), "quality");
    const threw = "validation is missing or does not wrap parsing";
    assert.equal(isThrowInsteadOfInvalidFinding(threw), true);
    assert.equal(isThrowInsteadOfInvalidFinding("Ga(...) is not a function"), false);
    assert.equal(chapterOf("throwInsteadOfInvalid"), "quality");
    assert.equal(chapterOf("pageError", { message: threw }), "quality");
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
    assert.match(lines.join("\n"), /Not checked:.*2\.5\.7.*AAA/);
    assert.match(lines.join("\n"), /2\.1\.1/);
    assert.match(lines.join("\n"), /2\.1\.2/);
    assert.match(lines.join("\n"), /2\.4\.3/);
    assert.doesNotMatch(lines.join("\n"), /Not checked:.*2\.1\.2/);
    assert.doesNotMatch(lines.join("\n"), /Not checked:.*2\.4\.3/);
    assert.doesNotMatch(lines.join("\n"), /Guide:/);
    assert.doesNotMatch(lines.join("\n"), /meets AA/i);
  });
});
