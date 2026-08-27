import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clickFailureMessage,
  coveredByMessage,
  isUselessClickHit,
  parsePlaywrightInterceptor,
} from "../src/executor/click-hit.js";
import { describeFromHtml, describeInterceptorHtml } from "../src/surveyor/where.js";

const intercepted = `locator.click: Timeout 2000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: 'Cash Flow' })
  - attempting click action
    - <html lang="en"> intercepts pointer events
  - retrying click action
    - <div class="fvs-menu-surface-base fvs-menu-surface--open"> intercepts pointer events
`;

describe("parsePlaywrightInterceptor", () => {
  it("names the last covering node, not html", () => {
    assert.equal(parsePlaywrightInterceptor(intercepted), "div.fvs-menu-surface-base");
    assert.equal(parsePlaywrightInterceptor("locator.click: Timeout 2000ms exceeded."), undefined);
    assert.equal(
      parsePlaywrightInterceptor(`locator.click: Timeout 2000ms exceeded.
Call log:
  - <html lang="en"> intercepts pointer events
`),
      undefined,
    );
  });
});

describe("clickFailureMessage", () => {
  it("prefers the live hit over the Playwright timeout line", () => {
    assert.equal(
      clickFailureMessage({
        widgetKey: "page.button_cash_flow",
        error: intercepted,
        hit: 'button "Sign Out"',
      }),
      'page.button_cash_flow click hit button "Sign Out" instead of the control',
    );
  });

  it("falls back to the interceptor tag when the live hit is html", () => {
    assert.equal(
      clickFailureMessage({
        widgetKey: "page.button_cash_flow",
        error: intercepted,
        hit: "html",
      }),
      "page.button_cash_flow click hit div.fvs-menu-surface-base instead of the control",
    );
  });

  it("keeps the compact timeout line when nothing named the cover", () => {
    assert.match(
      clickFailureMessage({
        widgetKey: "page.save",
        error: "locator.click: Timeout 2000ms exceeded.\nCall log:\n  - waiting",
      }),
      /Timeout 2000ms exceeded/,
    );
  });
});

describe("coveredByMessage", () => {
  it("names the covering control", () => {
    assert.equal(
      coveredByMessage("page.button_cash_flow", 'button "Sign Out"'),
      'page.button_cash_flow is covered by button "Sign Out"',
    );
    assert.equal(coveredByMessage("page.save", "html"), "page.save is covered by another layer");
  });
});

describe("isUselessClickHit", () => {
  it("drops html/body and empty names", () => {
    assert.equal(isUselessClickHit("html"), true);
    assert.equal(isUselessClickHit("body"), true);
    assert.equal(isUselessClickHit(""), true);
    assert.equal(isUselessClickHit('button "Sign Out"'), false);
    assert.equal(isUselessClickHit("div.fvs-menu-surface-base"), false);
  });
});

describe("describeInterceptorHtml", () => {
  it("uses a class token when the opening tag has no name", () => {
    assert.equal(describeInterceptorHtml('<div class="fvs-menu-surface-base">'), "div.fvs-menu-surface-base");
    assert.equal(describeFromHtml('<div class="fvs-menu-surface-base">'), "div.fvs-menu-surface-base");
    assert.equal(describeInterceptorHtml('<button aria-label="Close">'), 'button "Close"');
  });
});
