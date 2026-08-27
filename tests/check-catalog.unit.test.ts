import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catalogIdFor, catalogPageHref, CHECKS, checkByRule, FINDINGS_SITE } from "../src/reports/check-catalog.js";
import { specLink } from "../src/reports/spec-links.js";
import { DOCS_MAP, DOCS_SITE } from "../src/schema/site.js";

describe("check catalog", () => {
  it("keeps ids unique and never empty", () => {
    const ids = CHECKS.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const c of CHECKS) {
      assert.match(c.id, /^(T|V|A|Q)-\S+$/);
      assert.ok(c.summary.length > 20, c.id);
    }
  });

  it("points every catalog row with a WCAG SC at a W3C Understanding URL", () => {
    for (const c of CHECKS) {
      if (!c.sc) continue;
      const spec = specLink(c.rule);
      assert.ok(spec, c.id);
      assert.match(spec!.href, /^https:\/\/www\.w3\.org\/WAI\/WCAG22\/Understanding\//, c.id);
    }
  });

  it("publishes catalog and map guide on the docs site", () => {
    assert.equal(FINDINGS_SITE, DOCS_SITE);
    assert.equal(catalogPageHref("T-01"), `${DOCS_SITE}/findings/T-01/`);
    assert.equal(DOCS_MAP, `${DOCS_SITE}/map/`);
  });

  it("pins clickableNonWidget to A-2.1.1 and overflow 320 to A-1.4.10", () => {
    assert.equal(checkByRule("clickableNonWidget")?.id, "A-2.1.1");
    assert.equal(catalogIdFor("clickableNonWidget"), "A-2.1.1");
    assert.equal(catalogIdFor("keyboardTrap"), "A-2.1.2");
    assert.equal(catalogIdFor("focusOrder"), "A-2.4.3");
    assert.equal(catalogIdFor("color-contrast"), undefined);
    assert.equal(catalogIdFor("overlap"), "V-03");
    assert.equal(catalogIdFor("overflow", { viewport: "other" }), "V-01");
    assert.equal(catalogIdFor("overflow", { viewport: "320" }), "A-1.4.10");
    assert.equal(catalogIdFor("overflow", { where: "main @ 320px" }), "A-1.4.10");
    assert.equal(checkByRule("serverRefusedSubmit")?.id, "Q-01");
    assert.equal(catalogIdFor("serverRefusedSubmit"), "Q-01");
    assert.equal(checkByRule("acceptedInvalid")?.id, "Q-02");
    assert.equal(catalogIdFor("acceptedInvalid"), "Q-02");
    assert.equal(checkByRule("throwInsteadOfInvalid")?.id, "Q-03");
    assert.equal(catalogIdFor("throwInsteadOfInvalid"), "Q-03");
    assert.equal(catalogIdFor("align"), "V-17");
    assert.equal(catalogIdFor("unknownId"), "T-09");
    assert.equal(catalogIdFor("expectFailed"), "Q-22");
    assert.equal(catalogIdFor("fenceViolation"), undefined);
    assert.equal(checkByRule("align")?.id, "V-17");
    assert.equal(catalogIdFor("align"), "V-17");
    assert.equal(checkByRule("unknownId")?.id, "T-09");
    assert.equal(catalogIdFor("unknownId"), "T-09");
    assert.equal(checkByRule("document-title-placeholder")?.id, "Q-04");
    assert.equal(catalogIdFor("document-title-placeholder"), "Q-04");
    assert.equal(checkByRule("pageError")?.id, "Q-16");
    assert.equal(catalogIdFor("pageError"), "Q-16");
    assert.equal(checkByRule("notFound")?.id, "Q-17");
    assert.equal(catalogIdFor("notFound"), "Q-17");
    assert.equal(checkByRule("httpError")?.id, "Q-18");
    assert.equal(catalogIdFor("httpError"), "Q-18");
  });
});
