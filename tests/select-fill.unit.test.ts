import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatSelectOptionList,
  actablePaintedIndexes,
  clickablePaintedIndexes,
  listRowIsActable,
  listRowIsGroupChrome,
  listRowIsPainted,
  liveOptionsFromOptionEls,
  liveOptionsFromSnaps,
  matchListedOption,
  matchSelectOption,
  pickListedOption,
  pickSelectOption,
  selectOptionQuery,
  type ListRowSnap,
} from "../src/executor/select-options.js";

const OPTIONS = [
  { value: "", label: "Select type" },
  { value: "mailing", label: "Mailing" },
  { value: "remittance", label: "Remittance" },
  { value: "physical", label: "Physical" },
];

describe("liveOptionsFromOptionEls", () => {
  function el(attrs: Record<string, string | null>, text = ""): {
    getAttribute(name: string): string | null;
    textContent: string | null;
  } {
    return {
      getAttribute(name) {
        return Object.hasOwn(attrs, name) ? attrs[name]! : null;
      },
      textContent: text,
    };
  }

  it("reads value and label from attributes both HTMLElement and SVGElement share", () => {
    assert.deepEqual(liveOptionsFromOptionEls([el({ value: "no", label: "Norway" }, "Norway")]), [
      { value: "no", label: "Norway" },
    ]);
    assert.deepEqual(liveOptionsFromOptionEls([el({}, "Sweden")]), [{ value: "Sweden", label: "Sweden" }]);
    assert.deepEqual(liveOptionsFromOptionEls([el({ disabled: "" }, "Hidden")]), []);
  });
});

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
    assert.equal(
      matchListedOption(
        [
          { value: "no", label: "Norway" },
          { value: "dk", label: "Denmark" },
        ],
        "Sweden",
      ),
      undefined,
    );
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

  it("prefers Active listed rows and skips Draft/Blacklisted when anything else exists", () => {
    const vendors = [
      { value: "d", label: "Draft Co — VND-00008" },
      { value: "b", label: "Blacklisted LLC — VND-00009" },
      { value: "a", label: "Acme Inc — Active" },
    ];
    assert.equal(pickListedOption(vendors, "capillus vinitor")?.value, "a");
    assert.equal(pickListedOption(vendors, "Draft Co — VND-00008")?.value, "d");
    const onlyDraft = [{ value: "d", label: "Draft Co" }];
    assert.equal(pickListedOption(onlyDraft, "x")?.value, "d");
    assert.equal(pickSelectOption(vendors, () => 0), "a");
  });
});

function snap(partial: Partial<ListRowSnap> & Pick<ListRowSnap, "value" | "label" | "tag">): ListRowSnap {
  return {
    role: "",
    disabled: false,
    ariaDisabled: false,
    pointerEvents: "auto",
    tabIndex: -1,
    hasOwnClick: false,
    ...partial,
  };
}

describe("list row actable", () => {
  it("keeps standard options and custom rows that actually receive clicks", () => {
    assert.equal(listRowIsActable(snap({ value: "1", label: "Great Basin", tag: "div", role: "option" })), true);
    assert.equal(
      listRowIsActable(snap({ value: "1", label: "Great Basin", tag: "li", role: "option", pointerEvents: "none" })),
      true,
    );
    assert.equal(listRowIsActable(snap({ value: "mailing", label: "Mailing", tag: "option" })), true);
    assert.equal(listRowIsActable(snap({ value: "1", label: "Row", tag: "button" })), true);
    assert.equal(listRowIsActable(snap({ value: "1", label: "Row", tag: "div", hasOwnClick: true })), true);
    assert.equal(listRowIsActable(snap({ value: "1", label: "Row", tag: "div", tabIndex: 0 })), true);
  });

  it("drops group chrome that is not a hit target", () => {
    assert.equal(
      listRowIsActable(snap({ value: "recent", label: "Recently used", tag: "div", role: "presentation" })),
      false,
    );
    assert.equal(
      listRowIsActable(snap({ value: "recent", label: "Recently used", tag: "div", pointerEvents: "none" })),
      false,
    );
    assert.equal(listRowIsActable(snap({ value: "h", label: "Recently used", tag: "h3" })), false);
    assert.equal(listRowIsActable(snap({ value: "g", label: "Matters", tag: "div", role: "group" })), false);
    assert.equal(listRowIsActable(snap({ value: "x", label: "Row", tag: "div" })), false);
    assert.equal(
      listRowIsActable(snap({ value: "1", label: "Off", tag: "div", role: "option", ariaDisabled: true })),
      false,
    );
    const harvested = liveOptionsFromSnaps([
      snap({ value: "recent", label: "Recently used", tag: "div" }),
      snap({ value: "1", label: "Great Basin", tag: "div", role: "option" }),
    ]);
    assert.deepEqual(
      harvested.map((o) => o.value),
      ["1"],
    );
    const mixed = [
      snap({ value: "recent", label: "Recently used", tag: "div", role: "presentation", width: 120, height: 16 }),
      snap({ value: "1", label: "Great Basin", tag: "div", role: "option", width: 120, height: 40 }),
      snap({ value: "2", label: "Holloway", tag: "div", role: "option", width: 120, height: 40 }),
      snap({ value: "hid", label: "Template", tag: "li", role: "option", width: 0, height: 0 }),
    ];
    assert.deepEqual(actablePaintedIndexes(mixed), [1, 2]);
    assert.equal(listRowIsPainted(mixed[3]!), false);
    assert.equal(listRowIsPainted(snap({ value: "1", label: "Row", tag: "div", role: "option" })), true);
    assert.equal(listRowIsGroupChrome(mixed[0]!), true);
    const listenerOnly = [
      snap({ value: "recent", label: "Recently used", tag: "div", role: "presentation", width: 120, height: 16 }),
      snap({ value: "1", label: "Alpha Matter Alpha LLC", tag: "div", width: 120, height: 40 }),
    ];
    assert.deepEqual(actablePaintedIndexes(listenerOnly), []);
    assert.deepEqual(clickablePaintedIndexes(listenerOnly), [1]);
  });
});
