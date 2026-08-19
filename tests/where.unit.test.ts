import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { joinWheres } from "../src/schema/quality.js";
import { compactSelector, describeFromHtml, describeQualityWhere } from "../src/surveyor/where.js";

describe("quality where locators", () => {
  it("prefers data-testid and stable id over CSS soup", () => {
    assert.equal(describeFromHtml('<button data-testid="go" class="css-ab">Go</button>'), 'button[data-testid="go"]');
    assert.equal(describeFromHtml('<span id="dup">also</span>'), "#dup");
    assert.equal(describeFromHtml('<img alt="hero" src="x.png">'), 'img "hero"');
    assert.equal(describeFromHtml('<a href="/customers">Customers</a>'), 'a "Customers"');
  });

  it("compacts html-validate selectors by dropping html/body and nth-child", () => {
    assert.equal(compactSelector("html > body > button:nth-child(3) > div"), "button > div");
    assert.equal(compactSelector("html > body > span"), "span");
    assert.equal(
      describeQualityWhere({
        html: "<div>",
        selector: "html > body > button:nth-child(3) > div",
      }),
      "div (button > div)",
    );
  });

  it("joins distinct examples and caps at three", () => {
    assert.equal(joinWheres('a "Milkshake"', 'span "Settings"'), 'a "Milkshake" · span "Settings"');
    assert.equal(joinWheres('a "Milkshake"', 'a "Milkshake"'), 'a "Milkshake"');
    assert.equal(joinWheres("one · two · three", "four"), "one · two · three");
  });
});
