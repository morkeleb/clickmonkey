import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isListedControl, planControlFill } from "../src/executor/field-control.js";

const ADDRESS = [
  { value: "", label: "Select type" },
  { value: "mailing", label: "Mailing" },
  { value: "physical", label: "Physical" },
];

describe("field control registry", () => {
  it("treats native select and harvested typeahead lists as listed controls", () => {
    assert.equal(isListedControl({ type: "select" }), true);
    assert.equal(isListedControl({ type: "text", options: [{ value: "NO", label: "Norway" }] }), true);
    assert.equal(isListedControl({ type: "text" }), false);
    assert.equal(isListedControl({ type: "checkbox" }), false);
  });

  it("plans checkbox, select, and listed typeahead from the same table", () => {
    assert.equal(planControlFill({ id: "agree", value: "false", type: "checkbox" }, () => 0, false), "true");
    assert.equal(planControlFill({ id: "agree", value: "false", type: "checkbox" }, () => 0.9, false), "false");
    assert.equal(
      planControlFill({ id: "addressType", value: "", type: "select", options: ADDRESS }, () => 0, false),
      "mailing",
    );
    assert.equal(
      planControlFill({ id: "addressType", value: "", type: "select", options: ADDRESS }, () => 0, true),
      "",
    );
    assert.equal(
      planControlFill(
        { id: "country", value: "", type: "text", options: [{ value: "NO", label: "Norway" }] },
        () => 0,
        false,
      ),
      "NO",
    );
    assert.equal(planControlFill({ id: "name", value: "", type: "text" }, () => 0.9, false), undefined);
  });
});
