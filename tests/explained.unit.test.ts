import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHECKS } from "../src/reports/check-catalog.js";
import { CHECK_SOURCES, checkOf, findingHitOf, mustCheck, ruleForFinding } from "../src/reports/check.js";
import { specLink } from "../src/reports/spec-links.js";

describe("check (finding class)", () => {
  it("gives every catalogued rule a code, why paragraph, and http(s) URL", () => {
    const rules = new Set<string>([
      ...CHECK_SOURCES.visual,
      ...CHECK_SOURCES.testability,
      ...CHECK_SOURCES.findingKind,
      ...CHECK_SOURCES.htmlValidate,
      ...CHECK_SOURCES.axeExtra,
      ...CHECK_SOURCES.catalog,
    ]);
    for (const rule of rules) {
      const hit = checkOf(rule);
      assert.ok(hit, rule);
      assert.ok(hit!.code.length > 0, rule);
      assert.ok(hit!.why.length > 20, `${rule} why`);
      assert.match(hit!.href, /^https?:\/\//, `${rule} ${hit!.href}`);
      assert.equal(specLink(rule)?.href, hit!.href, rule);
    }
    assert.equal(checkOf("overlap")?.code, "V-03");
    assert.equal(checkOf("color-contrast")?.code, "A-1.4.3");
    assert.equal(checkOf("no-dup-id")?.code, "html-validate no-dup-id");
    assert.equal(checkOf("tabindex")?.code, "axe tabindex");
    assert.equal(checkOf("expectFailed")?.code, "Q-22");
  });

  it("maps a finding hit to one Check, with page and optional screenshot", () => {
    const silent =
      "Save did not submit the form: no navigation, no write request, and no invalid fields were shown";
    assert.equal(ruleForFinding({ kind: "expectFailed", message: silent }), "silentSubmit");
    assert.equal(
      ruleForFinding({
        kind: "httpError",
        message: "HTTP 409 POST https://app/api/vouchers: Vendor has status Blacklisted",
      }),
      "serverRefusedSubmit",
    );
    assert.equal(ruleForFinding({ kind: "httpError", message: "HTTP 500 GET https://app/x" }), "httpError");
    assert.equal(
      ruleForFinding({ kind: "visualIssue", message: "clip: BILLABLE cut off", widgetRef: "clip" }),
      "clip",
    );
    const hit = findingHitOf(
      {
        kind: "uiIssue",
        message: "Button overlaps the title",
        pageId: "clients_new",
        url: "https://app.example/clients/new",
        screenshotPath: "/tmp/shot.png",
      },
    );
    assert.equal(hit.check.code, "Q-21");
    assert.equal(hit.pageId, "clients_new");
    assert.equal(hit.screenshotPath, "/tmp/shot.png");
    assert.equal(hit.message, "Button overlaps the title");
    const silentHit = findingHitOf(
      { kind: "expectFailed", message: silent },
      { pageId: "vouchers_new", url: "https://app.example/vouchers/new", screenshotPath: "/tmp/save.png" },
    );
    assert.equal(silentHit.check.rule, "silentSubmit");
    assert.equal(silentHit.pageId, "vouchers_new");
    assert.equal(silentHit.screenshotPath, "/tmp/save.png");
    assert.match(silentHit.check.why, /3\.3\.1/);
    assert.match(silentHit.check.href, /error-identification/);
    assert.match(silentHit.check.expected ?? "", /Save submits/);
    assert.equal(silentHit.expected, undefined);
  });

  it("throws on a rule with no page", () => {
    assert.throws(() => mustCheck("not-a-real-rule"), /unexplained check/);
  });

  it("keeps catalog ids unique", () => {
    const ids = CHECKS.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});
