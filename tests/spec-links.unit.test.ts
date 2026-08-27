import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classLabelFor } from "../src/reports/labels.js";
import { specLink, specLinkMarkdown } from "../src/reports/spec-links.js";

describe("spec links", () => {
  it("points axe/WCAG rules at Understanding docs", () => {
    const contrast = specLink("color-contrast");
    assert.equal(contrast?.label, "WCAG 1.4.3 Contrast");
    assert.equal(contrast?.href, "https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html");
    assert.match(specLinkMarkdown("focusVisible") ?? "", /2\.4\.7/);
    assert.match(specLinkMarkdown("silentSubmit") ?? "", /3\.3\.1/);
    assert.match(specLink("targetSize")?.href ?? "", /target-size-minimum/);
    assert.equal(specLink("clickableNonWidget")?.label, "WCAG 2.1.1 Keyboard");
    assert.match(specLink("clickableNonWidget")?.href ?? "", /Understanding\/keyboard/);
    assert.match(specLink("keyboardTrap")?.href ?? "", /no-keyboard-trap/);
    assert.match(specLink("focusOrder")?.href ?? "", /focus-order/);
  });

  it("points html-validate and HTML authoring rules at their specs", () => {
    assert.equal(
      specLink("element-permitted-content")?.href,
      "https://html-validate.org/rules/element-permitted-content.html",
    );
    assert.equal(specLink("no-dup-id")?.href, "https://html-validate.org/rules/no-dup-id.html");
    assert.match(specLink("implicitSubmit")?.href ?? "", /attr-button-type/);
    assert.match(specLink("noopener")?.href ?? "", /link-type-noopener/);
  });

  it("points visual/testability catalog pages when there is no WCAG URL", () => {
    assert.equal(specLink("overlap")?.label, "Overlap");
    assert.match(specLink("overlap")?.href ?? "", /findings\/V-03/);
    assert.equal(specLink("missingStableId")?.label, "Missing stable id");
    assert.equal(specLink("serverRefusedSubmit")?.label, "Server refused submit");
    assert.match(specLink("serverRefusedSubmit")?.href ?? "", /findings\/Q-01/);
    assert.equal(specLink("acceptedInvalid")?.label, "Invalid input accepted");
    assert.match(specLink("acceptedInvalid")?.href ?? "", /findings\/Q-02/);
    assert.equal(specLink("throwInsteadOfInvalid")?.label, "Threw instead of invalid");
    assert.match(specLink("throwInsteadOfInvalid")?.href ?? "", /findings\/Q-03/);
  });

  it("points axe extras without WCAG SC at Deque University", () => {
    for (const rule of ["tabindex", "heading-order", "empty-heading", "label-title-only"] as const) {
      const href = specLink(rule)?.href ?? "";
      assert.match(href, new RegExp(rule));
      assert.match(href, /dequeuniversity/i);
    }
  });

  it("uses spec titles as report labels, not T-01 / Q-1", () => {
    const row = (rule: string, chapter: "testability" | "accessibility" | "visual" | "quality") => ({
      chapter,
      severity: "error",
      pages: 1,
      rule,
      key: rule,
    });
    assert.equal(classLabelFor(row("missingStableId", "testability")), "Missing stable id");
    assert.equal(classLabelFor(row("overlap", "visual")), "Overlap");
    assert.equal(classLabelFor(row("color-contrast", "accessibility")), "WCAG 1.4.3 Contrast");
    assert.equal(classLabelFor(row("no-dup-id", "quality")), "html-validate no-dup-id");
    assert.equal(classLabelFor(row("implicitSubmit", "visual")), "HTML button type");
    assert.equal(classLabelFor(row("serverRefusedSubmit", "quality")), "Server refused submit");
    assert.equal(classLabelFor(row("acceptedInvalid", "quality")), "Invalid input accepted");
    assert.equal(classLabelFor(row("throwInsteadOfInvalid", "quality")), "Threw instead of invalid");
  });
});

