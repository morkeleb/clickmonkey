import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  optionSearchQuery,
  listedPicksToTry,
  listedSearchQueries,
  listedLiveLooksEmpty,
  listedValueIsCommitted,
  isListedSearchProbe,
  pickOpenTypeahead,
  pollListedOptions,
  SEARCH_PROBES,
  skipTypeaheadCatalogMiss,
  skipTypeaheadNoRows,
  shouldProbeListed,
  shouldProbeTypeahead,
  liveLooksLikePick,
  typeaheadChipText,
  typeaheadMissMessage,
  LISTED_CLICK_LOCATOR_COUNT,
  LISTED_CLICK_MS,
} from "../src/executor/typeahead.js";
import { sliceTimeoutMs } from "../src/executor/timeout.js";

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

describe("liveLooksLikePick", () => {
  it("rejects a leftover 1-char probe and accepts the listed label", () => {
    const denmark = { value: "Denmark", label: "Denmark" };
    assert.equal(liveLooksLikePick("a", denmark), false);
    assert.equal(liveLooksLikePick("Denmark", denmark), true);
    assert.equal(liveLooksLikePick("Great Basin", { value: "1", label: "Great Basin Logistics" }), true);
  });

  it("accepts a truncated Filevine chip of the harvested title+subtitle row", () => {
    const basin = { value: "1", label: "Great Basin logistics Great Basin Logistics Inc" };
    assert.equal(liveLooksLikePick("Grea...", basin), true);
    assert.equal(liveLooksLikePick("Grea... Great Basin Logistics Inc", basin), true);
    assert.equal(liveLooksLikePick("Select a matter", basin), false);
    assert.equal(liveLooksLikePick("a", basin), false);
    assert.equal(liveLooksLikePick("aveho eos", basin), false);
  });
});

describe("listedValueIsCommitted", () => {
  it("treats Select/Search prompts and leftover probes as empty", () => {
    assert.equal(listedLiveLooksEmpty("Select a party"), true);
    assert.equal(listedLiveLooksEmpty("Search vendors"), true);
    assert.equal(listedLiveLooksEmpty("Choose type"), true);
    assert.equal(listedLiveLooksEmpty("Acme Inc"), false);
    assert.equal(listedLiveLooksEmpty("MM/DD/YYYY", "MM/DD/YYYY"), true);
    assert.equal(isListedSearchProbe("a"), true);
    assert.equal(isListedSearchProbe("e"), true);
    assert.equal(isListedSearchProbe("Acme"), false);
    assert.equal(listedValueIsCommitted("Select a party"), false);
    assert.equal(listedValueIsCommitted("a"), false);
    assert.equal(listedValueIsCommitted("Grea..."), true);
    assert.equal(listedValueIsCommitted("Acme Inc"), true);
  });
});

describe("typeaheadChipText", () => {
  it("reads a selected chip even when Clear is in the host text", () => {
    assert.equal(typeaheadChipText("Grea... Clear"), "Grea...");
    assert.equal(
      typeaheadChipText("Grea... Clear\nGreat Basin\nLogistics Inc"),
      "Grea... Great Basin Logistics Inc",
    );
    assert.equal(typeaheadChipText("Clear"), "");
    assert.equal(typeaheadChipText(""), "");
  });
});

describe("SEARCH_PROBES", () => {
  it("covers a letter, a digit, and two-character tokens", () => {
    assert.deepEqual([...SEARCH_PROBES], ["a", "e", "s", "1", "an", "in", "st", "11"]);
  });

  it("types short probes into an empty listed picker, never a two-word faker phrase", () => {
    assert.deepEqual([...listedSearchQueries()], ["a", "e"]);
    assert.equal(listedSearchQueries("Norway")[0], "Norway");
    assert.deepEqual([...listedSearchQueries("beatus bos")], ["a", "e"]);
    assert.equal(
      shouldProbeListed({ wanted: "patruus mollitia", options: [], force: true, openedEmpty: true }),
      true,
    );
    for (const q of listedSearchQueries()) {
      assert.ok(!/\s/.test(q), q);
      assert.ok(q.length <= 2, q);
    }
  });
});

describe("listed click budget", () => {
  it("does not give each of 8 locators the full --timeout", () => {
    const slice = sliceTimeoutMs(90_000, { cap: LISTED_CLICK_MS, attempts: LISTED_CLICK_LOCATOR_COUNT, now: 0 });
    assert.equal(slice, LISTED_CLICK_MS);
    assert.ok(LISTED_CLICK_MS * LISTED_CLICK_LOCATOR_COUNT < 90_000);
  });
});

describe("optionSearchQuery", () => {
  it("uses a leading numeric code so coded options search the code", () => {
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

  it("tries later painted rows when the first harvested row is not the match", () => {
    const matters = [
      { value: "recent", label: "Recently used" },
      { value: "1", label: "Great Basin logistics Great Basin Logistics Inc" },
      { value: "2", label: "Holloway retainer Holloway & Associates PC" },
    ];
    const tries = listedPicksToTry(matters, "spes aeger");
    assert.ok(tries.some((o) => o.value === "1"));
    assert.ok(tries.some((o) => o.value === "2"));
    const matched = listedPicksToTry(matters, "Holloway retainer Holloway & Associates PC");
    assert.equal(matched[0]?.value, "2");
  });
});

describe("pollListedOptions", () => {
  function clockAt(start = 0) {
    let t = start;
    return {
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
    };
  }

  it("keeps polling past 500ms until rows appear", async () => {
    const clock = clockAt();
    const rows = [NAICS[0]!];
    const found = await pollListedOptions(async () => (clock.now() >= 600 ? rows : []), 2500, clock);
    assert.deepEqual(found, rows);
    assert.ok(clock.now() >= 600);
    assert.ok(clock.now() <= 2500);
  });

  it("returns empty when 500ms is not enough for a 600ms list", async () => {
    const clock = clockAt();
    const rows = [NAICS[0]!];
    const found = await pollListedOptions(async () => (clock.now() >= 600 ? rows : []), 500, clock);
    assert.deepEqual(found, []);
  });
});

describe("typeaheadMissMessage", () => {
  it("names the field and the query when the list is empty", () => {
    assert.equal(
      typeaheadMissMessage({ widgetKey: "page.lineitems_0__matterid", label: "Select a matter", wanted: "beatus bos" }),
      'Select a matter: no matching options for "beatus bos"',
    );
  });

  it("falls back to the map id when there is no visible name", () => {
    assert.equal(
      typeaheadMissMessage({ widgetKey: "page.emptyVendor" }),
      "page.emptyVendor: the list opened with no options to pick",
    );
  });

  it("lists options when a row was visible but not clickable", () => {
    assert.match(
      typeaheadMissMessage({
        widgetKey: "page.vendor",
        label: "Vendor",
        options: [{ value: "1", label: "Acme" }],
      }),
      /Vendor: could not click a listed option \(options: Acme\)/,
    );
  });

  it("does not treat an empty list as a miss when the query was catalog junk", () => {
    assert.equal(skipTypeaheadCatalogMiss("'><img src=x onerror=alert(1)>", []), true);
    assert.equal(skipTypeaheadCatalogMiss("') OR ('1'='1", []), true);
    assert.equal(skipTypeaheadCatalogMiss("beatus bos", []), false);
    assert.equal(shouldProbeTypeahead("beatus bos", []), false);
    assert.equal(
      shouldProbeListed({ wanted: "patruus mollitia", options: [], force: true, openedEmpty: true }),
      true,
    );
    assert.equal(
      shouldProbeListed({ wanted: "beatus bos", options: [], force: false, openedEmpty: true }),
      false,
    );
    assert.equal(shouldProbeListed({ wanted: "Alice", options: [], force: false, openedEmpty: false }), true);
    assert.equal(shouldProbeListed({ wanted: "x", options: NAICS, force: true }), false);
    assert.equal(
      shouldProbeListed({ wanted: "patruus mollitia", options: NAICS, force: true, openedEmpty: true }),
      false,
    );
    assert.equal(shouldProbeTypeahead("Alice", []), true);
    assert.equal(shouldProbeTypeahead("a", []), true);
    assert.equal(shouldProbeTypeahead("11", []), true);
    assert.equal(shouldProbeTypeahead("111110 — Soybean Farming", []), true);
    assert.equal(shouldProbeTypeahead("'><img src=x onerror=alert(1)>", []), false);
    assert.equal(shouldProbeTypeahead("Norway", COUNTRIES), false);
    assert.equal(skipTypeaheadNoRows("beatus bos", [], true), true);
    assert.equal(skipTypeaheadNoRows("Alice", [], false), false);
    assert.equal(skipTypeaheadNoRows("Alice", COUNTRIES, true), false);
    assert.equal(skipTypeaheadNoRows("vae sed", [], true, true), false);
    assert.equal(
      skipTypeaheadCatalogMiss("'><img src=x onerror=alert(1)>", [{ value: "1", label: "Acme" }]),
      false,
    );
  });
});
