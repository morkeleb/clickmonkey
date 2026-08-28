import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AXE_EXTRA_RULES } from "../src/reports/spec-links.js";
import { EXTRA_RULES, TAGS } from "../src/surveyor/a11y.js";

describe("a11y axe allowlist", () => {
  it("keeps wcag 2.0/2.1 A/AA tags without best-practice or 2.2", () => {
    assert.deepEqual([...TAGS], ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
    assert.equal((TAGS as readonly string[]).includes("best-practice"), false);
    assert.equal((TAGS as readonly string[]).includes("wcag22aa"), false);
  });

  it("enables exactly the extra rules", () => {
    assert.deepEqual([...EXTRA_RULES], [
      "tabindex",
      "heading-order",
      "skip-link",
      "empty-heading",
      "label-title-only",
      "aria-dialog-name",
      "label-content-name-mismatch",
    ]);
    assert.deepEqual([...EXTRA_RULES], [...AXE_EXTRA_RULES]);
  });
});
