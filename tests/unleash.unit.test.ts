import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clickKey,
  clickWasNoop,
  decideMap,
  decideUnleash,
  formSubmitAction,
  freshClicks,
  listModeScore,
  looksLikeSearchField,
  pickSelectOption,
  plausibleFill,
  rememberClick,
  viewWidgetSig,
} from "../src/brains/unleash.js";
import { fogHunger, FOG_FRESH_MS, FOG_OLD_MS, npcHunger } from "../src/brains/npc.js";
import { detectWalkerMode } from "../src/brains/walker-mode.js";
import type { View } from "../src/schema/view.js";

function viewOf(partial: Partial<View>): View {
  return {
    page: "home",
    surface: "page",
    stack: ["page"],
    shown: [],
    actions: [],
    ...partial,
  };
}

describe("clickKey", () => {
  it("groups sort toggles and pagination, and leaves other ids alone", () => {
    assert.equal(clickKey("button_sorted_descending__switch_to_ascending"), "~sort");
    assert.equal(clickKey("button_sorted_ascending__switch_to_descending"), "~sort");
    assert.equal(clickKey("button_previous"), "~page");
    assert.equal(clickKey("button_next"), "~page");
    assert.equal(clickKey("button_open_next_js_dev_tools"), "button_open_next_js_dev_tools");
    assert.equal(clickKey("~sort"), "~sort");
  });
});

describe("freshClicks", () => {
  it("drops both sort buttons after one flip", () => {
    const actions = [
      { id: "button_sorted_descending__switch_to_ascending" },
      { id: "button_sorted_ascending__switch_to_descending" },
    ];
    assert.equal(freshClicks(actions, ["button_sorted_descending__switch_to_ascending"]).length, 0);
  });

  it("drops a two-key ping-pong and keeps a third widget", () => {
    const actions = [
      { id: "combobox_status" },
      { id: "combobox_readiness" },
      { id: "button_save_draft" },
    ];
    const pingPong = [
      "combobox_status",
      "combobox_readiness",
      "combobox_status",
      "combobox_readiness",
    ];
    assert.deepEqual(
      freshClicks(actions, pingPong).map((a) => a.id),
      ["button_save_draft"],
    );
    assert.deepEqual(rememberClick(["a", "b", "c"], "d", 3), ["b", "c", "d"]);
  });
});

describe("formSubmitAction", () => {
  it("treats wizard Next as submit and list Next as pagination", () => {
    assert.equal(formSubmitAction([{ id: "button_next", label: "Next" }])?.id, "button_next");
    assert.equal(formSubmitAction([{ id: "button_next_step", label: "Next" }])?.id, "button_next_step");
    const list = [
      { id: "combobox_status", role: "combobox" as const },
      { id: "button_sorted_descending__switch_to_ascending" },
      { id: "button_next", label: "Next" },
    ];
    assert.equal(formSubmitAction(list), undefined);
    assert.equal(
      formSubmitAction(list, undefined, viewOf({ actions: list })),
      undefined,
    );
    const filterPager = viewOf({
      actions: [
        { id: "combobox_status", role: "combobox" },
        { id: "button_previous", label: "Previous" },
        { id: "button_next", label: "Next" },
      ],
    });
    assert.equal(formSubmitAction(filterPager.actions, undefined, filterPager), undefined);
  });

  it("does not treat a header Add button as submit", () => {
    assert.equal(formSubmitAction([{ id: "add_bank_account", label: "Add bank account" }]), undefined);
    assert.equal(formSubmitAction([{ id: "button_add_customer" }]), undefined);
    const bank = viewOf({
      shown: [{ id: "search", value: "", type: "text" }],
      actions: [{ id: "add_bank_account", label: "Add bank account" }],
    });
    assert.equal(
      formSubmitAction([{ id: "timesheets_filter_add_filter" }, { id: "button_save" }])?.id,
      "button_save",
    );
    assert.equal(formSubmitAction([{ id: "create_client_billing_splits_add_row" }]), undefined);
    assert.equal(
      formSubmitAction([
        { id: "create_client_billing_splits_add_row" },
        { id: "button_save", label: "Save" },
      ])?.id,
      "button_save",
    );
    assert.equal(detectWalkerMode({ view: bank, stepsUsed: 0 }).name, "nav");
    const d = decideUnleash({ view: bank, stepsUsed: 0, writePolicy: "allow" }, () => 0);
    assert.notEqual(d.mode, "form");
    assert.doesNotMatch((d.lines ?? [d.line]).join("\n"), /fill page\.search/);
  });

  it("fills create-form fields ahead of Lois search and clicks Save not add_row", () => {
    const view = viewOf({
      shown: [
        { id: "textbox_search_or_talk_to_lois", value: "", type: "text", label: "Search or talk to Lois" },
        { id: "clientname", value: "", type: "text" },
        { id: "clientcode", value: "", type: "text" },
      ],
      actions: [
        { id: "create_client_billing_splits_add_row" },
        { id: "button_cancel", label: "Cancel" },
        { id: "button_save", label: "Save" },
      ],
    });
    const d = decideUnleash({ view, stepsUsed: 0, writePolicy: "allow" }, () => 0.5);
    assert.equal(d.mode, "form");
    const text = (d.lines ?? [d.line]).join("\n");
    assert.match(text, /fill page\.clientname /);
    assert.doesNotMatch(text, /fill page\.textbox_search_or_talk_to_lois /);
    assert.match(text, /click page\.button_save/);
    assert.doesNotMatch(text, /add_row/);
  });
});

const ADDRESS_TYPE_OPTIONS = [
  { value: "", label: "Select type" },
  { value: "mailing", label: "Mailing" },
  { value: "remittance", label: "Remittance" },
  { value: "physical", label: "Physical" },
];

describe("pickSelectOption / plausibleFill", () => {
  it("picks a listed value and skips the empty placeholder", () => {
    assert.equal(pickSelectOption(ADDRESS_TYPE_OPTIONS, () => 0), "mailing");
    assert.equal(pickSelectOption(ADDRESS_TYPE_OPTIONS, () => 0.99), "physical");
    assert.equal(pickSelectOption(undefined, () => 0), undefined);
    assert.equal(pickSelectOption([], () => 0), undefined);
  });

  it("uses a select option instead of x when filling", () => {
    const field = {
      id: "addressType",
      value: "",
      type: "select" as const,
      options: ADDRESS_TYPE_OPTIONS,
    };
    assert.equal(plausibleFill(field, () => 0, false), "mailing");
    assert.equal(plausibleFill(field, () => 0, true), "");
    const name = plausibleFill({ id: "name", value: "", type: "text" }, () => 0.9, false);
    assert.ok(name.length > 0);
    assert.notEqual(name, "x");
    assert.equal(
      plausibleFill(
        { id: "country", value: "", type: "text", options: [{ value: "NO", label: "Norway" }] },
        () => 0,
        false,
      ),
      "NO",
    );
    assert.equal(plausibleFill({ id: "agree", value: "false", type: "checkbox" }, () => 0, false), "true");
    assert.equal(plausibleFill({ id: "agree", value: "false", type: "checkbox" }, () => 0.9, false), "false");
    assert.equal(plausibleFill({ id: "agree", value: "false", type: "checkbox" }, () => 0.9, true), "false");
  });

  it("skips a form submit already in recentClicks and hops a map no-op", () => {
    const form = viewOf({
      shown: [
        { id: "name", value: "x", type: "text" },
      ],
      actions: [{ id: "submit" }],
    });
    const again = decideUnleash(
      { view: form, stepsUsed: 1, writePolicy: "allow", recentClicks: ["submit"] },
      () => 0,
    );
    assert.doesNotMatch(again.line, /click page\.submit/);
    const two = viewOf({
      shown: [{ id: "name", value: "x", type: "text" }],
      actions: [{ id: "submit" }, { id: "save", label: "Save" }],
    });
    const other = decideUnleash(
      { view: two, stepsUsed: 1, writePolicy: "allow", recentClicks: ["submit"] },
      () => 0.5,
    );
    assert.match((other.lines ?? [other.line]).join("\n"), /click page\.save/);
    const mapView = viewOf({
      page: "banking_accounts",
      pages: ["home", "banking_accounts"],
      actions: [{ id: "add_bank_account", label: "Add bank account" }],
    });
    const hop = decideMap({ view: mapView, stepsUsed: 1, noopIds: ["add_bank_account"] });
    assert.match(hop.line, /^open /);
    assert.equal(
      clickWasNoop(
        { url: "https://app/banking/accounts", sig: viewWidgetSig(mapView) },
        { url: "https://app/banking/accounts", sig: viewWidgetSig(mapView) },
      ),
      true,
    );
  });

  it("with writePolicy allow randomizes a checkbox then submits", () => {
    const view = viewOf({
      shown: [{ id: "agree", value: "false", type: "checkbox" }],
      actions: [{ id: "submit" }],
    });
    const on = decideUnleash({ view, stepsUsed: 0, writePolicy: "allow" }, () => 0);
    assert.deepEqual(on.lines, ["fill page.agree true", "click page.submit"]);
    const off = decideUnleash({ view, stepsUsed: 0, writePolicy: "allow" }, () => 0.9);
    assert.deepEqual(off.lines, ["fill page.agree false", "click page.submit"]);
  });

  it("hops instead of Cancel after Submit is already in recentClicks", () => {
    const view = viewOf({
      page: "edit",
      pages: ["home", "edit"],
      shown: [{ id: "name", value: "x", type: "text" }],
      actions: [
        { id: "button_save", label: "Save" },
        { id: "button_cancel", label: "Cancel" },
      ],
    });
    const again = decideUnleash(
      { view, stepsUsed: 1, writePolicy: "allow", recentClicks: ["button_save"] },
      () => 0,
    );
    const text = (again.lines ?? [again.line]).join("\n");
    assert.doesNotMatch(text, /click page\.button_cancel/);
    assert.doesNotMatch(text, /click page\.button_save/);
    assert.match(again.line, /^open /);
  });

  it("does not keep filling a checkbox after Submit is filtered", () => {
    const view = viewOf({
      page: "edit",
      pages: ["home", "edit"],
      shown: [{ id: "agree", value: "false", type: "checkbox" }],
      actions: [{ id: "submit" }],
    });
    const again = decideUnleash(
      { view, stepsUsed: 1, writePolicy: "allow", recentClicks: ["submit"] },
      () => 0,
    );
    const text = (again.lines ?? [again.line]).join("\n");
    assert.doesNotMatch(text, /fill page\.agree/);
    assert.doesNotMatch(text, /click page\.submit/);
    assert.match(again.line, /^open /);
  });

  it("with writePolicy allow fills a native select from listed options", () => {
    const view = viewOf({
      shown: [
        {
          id: "addressType",
          value: "",
          type: "select",
          options: ADDRESS_TYPE_OPTIONS,
        },
      ],
      actions: [{ id: "submit" }],
    });
    const first = decideUnleash({ view, stepsUsed: 0, writePolicy: "allow" }, () => 0);
    assert.equal(first.mode, "form");
    assert.equal(first.lines?.[0], "fill page.addressType mailing");
    assert.doesNotMatch((first.lines ?? []).join("\n"), /\bx\b/);
  });
});

describe("looksLikeSearchField", () => {
  it("matches snake_case, camelCase, and exact q", () => {
    assert.equal(looksLikeSearchField({ id: "search", value: "", type: "text" }), true);
    assert.equal(looksLikeSearchField({ id: "search_input", value: "", type: "text" }), true);
    assert.equal(looksLikeSearchField({ id: "searchInput", value: "", type: "text" }), true);
    assert.equal(looksLikeSearchField({ id: "textbox_search_or_talk_to_lois", value: "", type: "text" }), true);
    assert.equal(looksLikeSearchField({ id: "q", value: "", type: "text" }), true);
    assert.equal(looksLikeSearchField({ id: "clientname", value: "", type: "text" }), false);
    assert.equal(looksLikeSearchField({ id: "findings", value: "", type: "text" }), false);
  });
});

describe("listModeScore", () => {
  it("needs two kinds of chrome, not two comboboxes", () => {
    assert.equal(
      listModeScore(
        viewOf({
          actions: [
            { id: "combobox_status", role: "combobox" },
            { id: "combobox_readiness", role: "combobox" },
          ],
        }),
      ),
      1,
    );
    assert.equal(
      listModeScore(
        viewOf({
          actions: [
            { id: "combobox_status", role: "combobox" },
            { id: "button_sorted_descending__switch_to_ascending" },
          ],
        }),
      ),
      2,
    );
    assert.equal(
      listModeScore(
        viewOf({
          actions: [
            { id: "combobox_language", role: "combobox", nav: true },
            { id: "combobox_currency", role: "combobox", nav: true },
            { id: "button_expand" },
          ],
        }),
      ),
      0,
    );
  });
});

describe("sort stay", () => {
  it("treats asc/desc as one control and hops after one flip", () => {
    const view = viewOf({
      page: "runs",
      pages: ["home", "runs"],
      actions: [
        { id: "button_sorted_descending__switch_to_ascending" },
        { id: "button_sorted_ascending__switch_to_descending" },
      ],
    });
    const first = decideUnleash({ view, stepsUsed: 0, recentClicks: [] }, () => 0);
    assert.equal(first.line, "click page.button_sorted_descending__switch_to_ascending");
    const afterOne = decideUnleash(
      { view, stepsUsed: 1, recentClicks: ["button_sorted_descending__switch_to_ascending"] },
      () => 0,
    );
    assert.match(afterOne.line, /^open /);
    assert.equal(afterOne.mode, "nav");
  });
});

describe("fog hunger", () => {
  it("is low when just seen and 1 when last land is 40 days old", () => {
    assert.ok(fogHunger(0) < fogHunger(FOG_FRESH_MS));
    assert.ok(fogHunger(FOG_FRESH_MS) < fogHunger(FOG_OLD_MS));
    assert.equal(fogHunger(FOG_OLD_MS), 1);
    assert.equal(fogHunger(FOG_OLD_MS * 2), 1);
    assert.equal(npcHunger(0, FOG_OLD_MS), 1);
    assert.ok(npcHunger(0, 0) < npcHunger(0, FOG_OLD_MS));
  });
});
