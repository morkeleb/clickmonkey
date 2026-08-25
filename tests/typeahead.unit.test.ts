import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { optionSearchQuery, pickOpenTypeahead } from "../src/executor/typeahead.js";

const NAICS = [
  { value: "111110 — Soybean Farming", label: "111110 — Soybean Farming" },
  { value: "111120 — Oilseed (except Soybean) Farming", label: "111120 — Oilseed (except Soybean) Farming" },
  { value: "111150 — Corn Farming", label: "111150 — Corn Farming" },
];

const COUNTRIES = [
  { value: "Norway", label: "Norway" },
  { value: "Sweden", label: "Sweden" },
  { value: "Denmark", label: "Denmark" },
];

describe("optionSearchQuery", () => {
  it("uses a leading numeric code so NAICS pickers search the code", () => {
    assert.equal(optionSearchQuery(NAICS[0]!), "111110");
  });

  it("uses the first real word when there is no code", () => {
    assert.equal(optionSearchQuery({ value: "1", label: "FV Admin — 1" }), "Admin");
    assert.equal(optionSearchQuery({ value: "no", label: "Norway" }), "Norway");
  });
});

describe("pickOpenTypeahead", () => {
  it("clicks a listed match when the planned fill is in the open list", () => {
    const hit = pickOpenTypeahead(COUNTRIES, "Norway");
    assert.equal(hit?.matched, true);
    assert.equal(hit?.pick.label, "Norway");
  });

  it("does not search faker junk; picks a listed row instead", () => {
    const hit = pickOpenTypeahead(NAICS, "beatus bos");
    assert.equal(hit?.matched, false);
    assert.equal(hit?.pick.label, "111110 — Soybean Farming");
    assert.equal(optionSearchQuery(hit!.pick), "111110");
  });

  it("returns nothing when the list is not open so fill can probe", () => {
    assert.equal(pickOpenTypeahead([], "beatus bos"), undefined);
    assert.equal(pickOpenTypeahead([], "Norway"), undefined);
  });
});
