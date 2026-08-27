import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkForFinding } from "../src/reports/check.js";
import { FINDING_WHY, whyFinding, whyFindingBlock, whyRule } from "../src/reports/why.js";
import { FindingKind } from "../src/schema/finding.js";
import { TestabilityCode } from "../src/schema/testability.js";
import { VISUAL_RULES } from "../src/surveyor/vision.js";

describe("why copy", () => {
  it("has a paragraph for every finding kind and testability code", () => {
    for (const kind of FindingKind.options) {
      assert.ok(FINDING_WHY[kind].length > 40, kind);
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
    assert.match(whyRule("clickableNonWidget") ?? "", /React onClick/);
    assert.match(whyRule("clickableNonWidget") ?? "", /addEventListener/);
    assert.match(whyRule("clickableNonWidget") ?? "", /map/);
    assert.match(whyRule("keyboardTrap") ?? "", /2\.1\.2/);
    assert.match(whyRule("focusOrder") ?? "", /2\.4\.3/);
    assert.match(whyFinding("expectFailed", "page.button_employees was not found") ?? "", /duplicate name|flake/);
    assert.match(whyFinding("expectFailed", "page.button_save is disabled") ?? "", /stayed disabled/);
    assert.match(whyFinding("httpError", "HTTP 403 POST https://app/api/x") ?? "", /API refused this user/);
    assert.equal(
      whyFinding(
        "expectFailed",
        "Save did not submit the form: no navigation, no write request, and no invalid fields were shown",
      ),
      undefined,
    );
    assert.match(
      checkForFinding({
        kind: "expectFailed",
        message:
          "Save did not submit the form: no navigation, no write request, and no invalid fields were shown",
      }).why,
      /no error|think Save worked|3\.3\.1/,
    );
    assert.match(whyRule("silentSubmit") ?? "", /3\.3\.1/);
    assert.match(whyRule("serverRefusedSubmit") ?? "", /UI let this submit/);
    assert.match(whyRule("acceptedInvalid") ?? "", /blank|junk/);
    assert.match(whyRule("throwInsteadOfInvalid") ?? "", /crashed the page/);
    assert.match(
      checkForFinding({ kind: "expectFailed", message: "Required field `page.name` accepted empty" }).why,
      /blank|junk|never showed an error/,
    );
    assert.match(
      checkForFinding({
        kind: "pageError",
        message: "validation is missing or does not wrap parsing",
      }).why,
      /crashed the page|field error/,
    );
    assert.match(whyFindingBlock("notFound", "HTTP 404"), /^> A link, hop, or redirect/);
    assert.match(
      checkForFinding({
        kind: "httpError",
        message: "HTTP 409 POST https://app/api/vouchers: Vendor has status Blacklisted",
      }).why,
      /UI let this submit|server refused/,
    );
    assert.match(FINDING_WHY.httpError, /never loaded or never saved/);
    assert.match(whyRule("other") ?? "", /pixel-only/);
  });
});
