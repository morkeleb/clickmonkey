import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fieldTypeOf } from "../src/surveyor/collect.js";

describe("fieldTypeOf", () => {
  it("maps a native select to select and a combobox input to combobox", () => {
    assert.equal(fieldTypeOf({ tag: "select", inputType: "", contentEditable: false, combobox: false }), "select");
    assert.equal(
      fieldTypeOf({ tag: "input", inputType: "text", contentEditable: false, combobox: true }),
      "combobox",
    );
    assert.equal(
      fieldTypeOf({ tag: "input", inputType: "text", contentEditable: false, combobox: false }),
      "text",
    );
    assert.equal(
      fieldTypeOf({ tag: "select", inputType: "", contentEditable: false, combobox: true }),
      "select",
    );
  });
});
