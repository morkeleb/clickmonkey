import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QA_LEFT, QA_LEFT_HREF } from "../src/reports/qa-left.js";

describe("qa-left leftover guide", () => {
  it("lists leftover A/AA for a person, not 2.1.2 or 2.4.3", () => {
    assert.match(QA_LEFT_HREF, /findings\/qa-left/);
    assert.ok(QA_LEFT.length >= 10);
    const blob = QA_LEFT.map((i) => i.sc).join(" ");
    assert.match(blob, /1\.2/);
    assert.match(blob, /1\.3\.2/);
    assert.match(blob, /2\.5\.7/);
    assert.match(blob, /3\.3\.8/);
    assert.match(blob, /4\.1\.3/);
    assert.equal(
      QA_LEFT.some((i) => i.sc === "2.1.2" || i.sc === "2.4.3"),
      false,
    );
    for (const item of QA_LEFT) {
      assert.ok(item.qa.length > 20, item.sc);
    }
  });
});
