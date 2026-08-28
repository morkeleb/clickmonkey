import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  axeRows,
  catalogIndexMarkdown,
  catalogListRows,
  clickmonkeyRows,
  htmlRows,
  htmlValidateRows,
  wcagRows,
} from "../src/reports/catalog-lists.js";

describe("catalog lists", () => {
  it("keeps ClickMonkey, AXE, WCAG, html-validate, and HTML in separate lists", () => {
    const ours = clickmonkeyRows();
    const axe = axeRows();
    const wcag = wcagRows();
    const htmlv = htmlValidateRows();
    const html = htmlRows();
    const oursRules = new Set(ours.map((r) => r.rule));
    const axeRules = new Set(axe.map((r) => r.rule));
    const wcagRules = new Set(wcag.map((r) => r.rule));
    assert.equal(oursRules.has("overlap"), true);
    assert.equal(oursRules.has("color-contrast"), false);
    assert.equal(oursRules.has("clickableNonWidget"), false);
    assert.equal(oursRules.has("implicitSubmit"), false);
    assert.equal(oursRules.has("no-dup-id"), false);
    assert.equal(oursRules.has("fenceViolation"), false);
    assert.equal(oursRules.has("writePolicyBlocked"), false);
    assert.equal(oursRules.has("uiIssue"), false);
    assert.equal(axeRules.has("color-contrast"), true);
    assert.equal(axeRules.has("tabindex"), true);
    assert.equal(axeRules.has("label-content-name-mismatch"), true);
    assert.equal(axeRules.has("clickableNonWidget"), false);
    assert.equal(axeRules.has("css-orientation-lock"), false);
    assert.equal(wcagRules.has("clickableNonWidget"), true);
    assert.equal(wcagRules.has("focusVisible"), true);
    assert.equal(wcagRules.has("targetSize"), true);
    assert.equal(wcagRules.has("color-contrast"), false);
    assert.ok(htmlv.some((r) => r.rule === "no-dup-id"));
    assert.ok(html.some((r) => r.rule === "implicitSubmit" && r.id === "V-12"));
    const seen = new Set<string>();
    for (const row of catalogListRows()) {
      assert.equal(seen.has(row.rule), false, `rule in two lists: ${row.rule}`);
      seen.add(row.rule);
    }
  });

  it("points each list at the original spec, not a parallel catalog", () => {
    const contrast = axeRows().find((r) => r.rule === "color-contrast");
    assert.equal(contrast?.title, "AXE color-contrast");
    assert.equal(contrast?.href, "https://dequeuniversity.com/rules/axe/4.13/color-contrast");
    const keyboard = wcagRows().find((r) => r.rule === "clickableNonWidget");
    assert.equal(keyboard?.title, "WCAG 2.1.1 Keyboard");
    assert.match(keyboard?.href ?? "", /Understanding\/keyboard/);
    assert.equal(keyboard?.id, "A-2.1.1");
    const dup = htmlValidateRows().find((r) => r.rule === "no-dup-id");
    assert.equal(dup?.title, "html-validate no-dup-id");
    assert.equal(dup?.id, "html-validate-no-dup-id");
    assert.match(dup?.href ?? "", /html-validate\.org\/rules\/no-dup-id/);
    const submit = htmlRows().find((r) => r.rule === "implicitSubmit");
    assert.match(submit?.href ?? "", /html\.spec\.whatwg\.org/);
    const overlap = clickmonkeyRows().find((r) => r.rule === "overlap");
    assert.equal(overlap?.id, "V-03");
    assert.match(overlap?.href ?? "", /findings\/V-03/);
  });

  it("renders GitHub Pages index as separate original-spec lists", () => {
    const md = catalogIndexMarkdown();
    assert.match(md, /^## ClickMonkey$/m);
    assert.match(md, /^## AXE$/m);
    assert.match(md, /^## WCAG$/m);
    assert.match(md, /^## html-validate$/m);
    assert.match(md, /^## HTML$/m);
    assert.ok(md.indexOf("## ClickMonkey") < md.indexOf("## AXE"));
    assert.match(md, /\[AXE color-contrast\]\(https:\/\/dequeuniversity\.com\/rules\/axe\/4\.13\/color-contrast\)/);
    assert.match(md, /\[WCAG 2\.1\.1 Keyboard\]\(https:\/\/www\.w3\.org\/WAI\/WCAG22\/Understanding\/keyboard\.html\)/);
    const clickStart = md.indexOf("## ClickMonkey");
    const axeStart = md.indexOf("## AXE");
    const wcagStart = md.indexOf("## WCAG");
    const click = md.slice(clickStart, axeStart);
    const axe = md.slice(axeStart, wcagStart);
    assert.doesNotMatch(click, /`color-contrast`/);
    assert.doesNotMatch(click, /`clickableNonWidget`/);
    assert.match(axe, /`color-contrast`/);
    assert.doesNotMatch(axe, /`clickableNonWidget`/);
    assert.doesNotMatch(md, /Q-19|fenceViolation|writePolicyBlocked|`uiIssue`/);
    assert.match(md, /\[html-validate no-dup-id\]\(html-validate-no-dup-id\/\)/);
    assert.match(md, /\[html-validate no-dup-id\]\(https:\/\/html-validate\.org\/rules\/no-dup-id\.html\)/);
    assert.match(md, /\[html-validate element-permitted-content\]\(html-validate-element-permitted-content\/\)/);
  });
});
