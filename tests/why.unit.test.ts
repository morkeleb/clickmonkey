import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { whyFinding, whyFindingBlock, whyRule } from "../src/reports/why.js";
import { FindingKind } from "../src/schema/finding.js";
import { TestabilityCode } from "../src/schema/testability.js";
import { VISUAL_RULES } from "../src/surveyor/vision.js";

describe("why copy", () => {
  it("has a paragraph for every finding kind and testability code", () => {
    for (const kind of FindingKind.options) {
      const why = whyFinding(kind, "x");
      assert.ok(why.length > 40, kind);
    }
    for (const code of TestabilityCode.options) {
      assert.ok(whyRule(code), code);
    }
    for (const rule of VISUAL_RULES) {
      assert.ok(whyRule(rule), rule);
    }
  });

  it("explains duplicate names and junk-crash pageErrors", () => {
    assert.match(whyRule("duplicateName") ?? "", /first one/);
    assert.match(whyFinding("pageError", "validation is missing or does not wrap parsing"), /field error/);
    assert.match(whyFinding("expectFailed", "page.button_employees was not found"), /duplicate name|flake/);
    assert.match(whyFinding("expectFailed", "page.button_save is disabled"), /stayed disabled/);
    assert.match(whyFindingBlock("notFound", "HTTP 404"), /^> A link, hop, or redirect/);
  });
});
