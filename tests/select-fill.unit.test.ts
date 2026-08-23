import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatSelectOptionList,
  matchListedOption,
  matchSelectOption,
  pickListedOption,
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

  it("matches typeahead labels case-insensitively and by prefix", () => {
    assert.equal(matchListedOption(OPTIONS, "MAILING")?.value, "mailing");
    assert.equal(matchListedOption(OPTIONS, "Mail")?.label, "Mailing");
    assert.equal(matchListedOption(OPTIONS, "zzz"), undefined);
  });

  it("matches a listed row that contains the fill as a token, not a mid-word substring", () => {
    const states = [
      { value: "ak", label: "Alaska (AK)" },
      { value: "md", label: "Maryland (MD)" },
      { value: "nd", label: "North Dakota (ND)" },
      { value: "sd", label: "South Dakota (SD)" },
    ];
    assert.equal(matchListedOption(states, "AK")?.label, "Alaska (AK)");
    assert.equal(matchListedOption(states, "MD")?.label, "Maryland (MD)");
    assert.equal(matchListedOption(states, "nd")?.label, "North Dakota (ND)");
    assert.equal(matchListedOption(states, "Maryland")?.label, "Maryland (MD)");
    assert.equal(matchListedOption(states, "TX"), undefined);
  });

  it("falls back to a listed row when the fill is not in the list", () => {
    const people = [{ value: "1", label: "FV Admin — 1" }];
    assert.equal(pickListedOption(people, "capillus vinitor")?.label, "FV Admin — 1");
    assert.equal(pickListedOption(people, "FV Admin — 1")?.value, "1");
    assert.equal(pickListedOption([], "x"), undefined);
  });
});
