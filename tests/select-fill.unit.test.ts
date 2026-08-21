import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatSelectOptionList,
  matchSelectOption,
  selectOptionQuery,
} from "../src/executor/select-options.js";

const OPTIONS = [
  { value: "", label: "Select type" },
  { value: "mailing", label: "Mailing" },
  { value: "remittance", label: "Remittance" },
  { value: "physical", label: "Physical" },
];

describe("select option match", () => {
  it("matches value or label and lists labels for errors", () => {
    assert.equal(matchSelectOption(OPTIONS, "mailing")?.value, "mailing");
    assert.equal(matchSelectOption(OPTIONS, "Mailing")?.value, "mailing");
    assert.equal(matchSelectOption(OPTIONS, "")?.label, "Select type");
    assert.equal(matchSelectOption(OPTIONS, "x"), undefined);
    assert.equal(
      formatSelectOptionList(OPTIONS),
      "Select type / Mailing / Remittance / Physical",
    );
    assert.equal(formatSelectOptionList([]), "(none)");
    assert.deepEqual(selectOptionQuery({ value: "mailing", label: "Mailing" }), { value: "mailing" });
    assert.deepEqual(selectOptionQuery({ value: "", label: "Select type" }), { label: "Select type" });
  });
});
