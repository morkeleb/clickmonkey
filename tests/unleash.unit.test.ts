import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clickKey,
  clickWasNoop,
  commitKindRank,
  decideMap,
  decideUnleash,
  formSubmitAction,
  isPrimaryFormCommit,
  freshClicks,
  isAddRepeatingRowAction,
  listModeScore,
  looksLikeSearchField,
  looksLikePageSearch,
  mappedPrimaryCommits,
  pickSelectOption,
  plausibleFill,
  rememberClick,
  repeatingRowCount,
  repeatingRowIndex,
  skipRepeatingChildField,
  isListedTypeaheadOption,
  listedTypeaheadOptions,
  alreadyPickedListedOption,
  looksLikeEmptyValue,
  looksLikeListedPicker,
  formFieldsToFill,
  FORM_COMMIT_RETRIES,
  stayActions,
  viewWidgetSig,
} from "../src/brains/unleash.js";
import type { Page } from "../src/schema/page-model.js";
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

  it("fills every empty field then Save, but only the first repeating child row", () => {
    const shown = [
      ...Array.from({ length: 13 }, (_, i) => ({ id: `f${i}`, value: "", type: "text" as const })),
      { id: "lineitems_0__amount", value: "", type: "text" as const },
      { id: "lineitems_1__amount", value: "", type: "text" as const },
    ];
    const view = viewOf({
      shown,
      actions: [
        { id: "button_add_line", label: "Add Line" },
        { id: "submit", label: "Save" },
      ],
    });
    const first = decideUnleash({ view, stepsUsed: 0, writePolicy: "allow" }, () => 0);
    assert.equal(first.mode, "form");
    const text = (first.lines ?? [first.line]).join("\n");
    assert.equal(first.lines?.filter((l) => l.startsWith("fill ")).length, 14);
    assert.match(text, /fill page\.f12 /);
    assert.match(text, /fill page\.lineitems_0__amount /);
    assert.doesNotMatch(text, /lineitems_1__/);
    assert.doesNotMatch(text, /add_line|Add Line/);
    assert.equal(first.lines?.at(-1), "click page.submit");
  });

  it("fills an empty typeahead then Save instead of clicking leftover listed rows", () => {
    assert.equal(isListedTypeaheadOption({ id: "option_acme", role: "option" }), true);
    assert.equal(isListedTypeaheadOption({ id: "option_expert_witness_vnd_00001" }), true);
    assert.equal(isListedTypeaheadOption({ id: "button_save", label: "Save" }), false);
    const view = viewOf({
      shown: [{ id: "vendorid", value: "", type: "text", required: true }],
      actions: [
        { id: "option_acme", role: "option", label: "Acme" },
        { id: "button_save", label: "Save" },
      ],
    });
    assert.equal(listedTypeaheadOptions(view.actions).length, 1);
    const d = decideUnleash({ view, stepsUsed: 0, writePolicy: "allow" }, () => 0.5);
    assert.equal(d.mode, "form");
    const text = (d.lines ?? [d.line]).join("\n");
    assert.match(text, /fill page\.vendorid /);
    assert.match(text, /click page\.button_save/);
    assert.doesNotMatch(text, /option_acme/);
  });

  it("fills remaining empties then Save instead of walking leftover listed rows", () => {
    const view = viewOf({
      shown: [
        { id: "vendorid", value: "", type: "text", required: true },
        { id: "legalname", value: "", type: "text" },
      ],
      actions: [
        { id: "option_acme", role: "option", label: "Acme" },
        { id: "option_beta", role: "option", label: "Beta" },
        { id: "button_save", label: "Save" },
      ],
    });
    assert.equal(alreadyPickedListedOption(view, ["option_acme"]), true);
    const d = decideUnleash(
      {
        view,
        stepsUsed: 1,
        writePolicy: "allow",
        recentClicks: ["option_acme"],
        formHits: { "home/page": 1 },
      },
      () => 0.5,
    );
    const text = (d.lines ?? [d.line]).join("\n");
    assert.match(text, /fill page\.vendorid /);
    assert.match(text, /fill page\.legalname /);
    assert.match(text, /click page\.button_save/);
    assert.doesNotMatch(text, /option_beta|option_acme/);
  });

  it("fills a new typeahead after the previous list is gone, without clicking leftover options", () => {
    const afterIndustry = viewOf({
      shown: [{ id: "create_client_billing_splits_attorney_0", value: "", type: "text" }],
      actions: [
        { id: "option_hannah_kim", role: "option", label: "Hannah Kim" },
        { id: "button_save", label: "Save" },
      ],
    });
    assert.equal(
      alreadyPickedListedOption(afterIndustry, ["option_id_111130___dry_pea_and_bean_farming"]),
      false,
    );
    const d = decideUnleash(
      {
        view: afterIndustry,
        stepsUsed: 2,
        writePolicy: "allow",
        recentClicks: ["option_id_111130___dry_pea_and_bean_farming"],
        formHits: { "home/page": 1 },
      },
      () => 0.5,
    );
    assert.equal(d.mode, "form");
    const text = (d.lines ?? [d.line]).join("\n");
    assert.match(text, /fill page\.create_client_billing_splits_attorney_0 /);
    assert.match(text, /click page\.button_save/);
    assert.doesNotMatch(text, /option_hannah_kim/);
  });

  it("fills optional listed chips on the form, required first, then Save", () => {
    const view = viewOf({
      shown: [
        { id: "vendorid", value: "", type: "text", required: true },
        { id: "reference", value: "", type: "text", required: true },
        { id: "lineitems_0__matterid", value: "", type: "text" },
        { id: "lineitems_0__officeid", value: "", type: "text" },
      ],
      actions: [{ id: "button_save", label: "Save" }],
    });
    assert.equal(looksLikeListedPicker({ id: "lineitems_0__matterid", value: "", type: "text" }), true);
    assert.equal(looksLikeListedPicker({ id: "vendorid", value: "", type: "text", required: true }), true);
    assert.equal(looksLikeListedPicker({ id: "matter", value: "", type: "text" }), false);
    assert.equal(looksLikeListedPicker({ id: "attorney", value: "", type: "text" }), false);
    assert.equal(looksLikeListedPicker({ id: "attorney", value: "Select attorney", type: "text" }), true);
    assert.equal(
      looksLikeListedPicker({ id: "vendor", value: "", type: "text", constraints: { placeholder: "Search vendors" } }),
      true,
    );
    assert.equal(looksLikeListedPicker({ id: "industry", value: "", type: "text" }), false);
    const d = decideUnleash({ view, stepsUsed: 0, writePolicy: "allow" }, () => 0.5);
    const text = (d.lines ?? [d.line]).join("\n");
    assert.match(text, /fill page\.vendorid /);
    assert.match(text, /fill page\.reference /);
    assert.match(text, /fill page\.lineitems_0__matterid /);
    assert.match(text, /fill page\.lineitems_0__officeid /);
    assert.match(text, /click page\.button_save/);
    const lines = text.split("\n");
    const req = Math.min(lines.findIndex((l) => /vendorid/.test(l)), lines.findIndex((l) => /reference/.test(l)));
    const opt = Math.min(lines.findIndex((l) => /matterid/.test(l)), lines.findIndex((l) => /officeid/.test(l)));
    assert.ok(req >= 0 && opt >= 0 && req < opt);
  });

  it("fills a required picker search, not Lois", () => {
    const view = viewOf({
      shown: [
        { id: "textbox_search_or_talk_to_lois", value: "", type: "text" },
        { id: "vendortype_search", value: "", type: "text", required: true },
        { id: "legalname", value: "", type: "text", required: true },
      ],
      actions: [{ id: "button_save", label: "Save" }],
    });
    const d = decideUnleash({ view, stepsUsed: 0, writePolicy: "allow" }, () => 0.5);
    const text = (d.lines ?? [d.line]).join("\n");
    assert.match(text, /fill page\.vendortype_search /);
    assert.match(text, /fill page\.legalname /);
    assert.doesNotMatch(text, /talk_to_lois/);
    assert.match(text, /click page\.button_save/);
  });

  it("fills a form body *_search even when it is not marked required", () => {
    const view = viewOf({
      shown: [
        { id: "textbox_search_or_talk_to_lois", value: "", type: "text", label: "Search or talk to Lois" },
        { id: "vendor_create_places_search", value: "", type: "text" },
        { id: "legalname", value: "Ada", type: "text", required: true },
      ],
      actions: [{ id: "button_save", label: "Save" }],
    });
    const d = decideUnleash({ view, stepsUsed: 0, writePolicy: "allow" }, () => 0.5);
    const text = (d.lines ?? [d.line]).join("\n");
    assert.match(text, /fill page\.vendor_create_places_search /);
    assert.doesNotMatch(text, /talk_to_lois/);
    assert.match(text, /click page\.button_save/);
  });

  it("fills leftover Select chips after Save fails, not add/remove rows", () => {
    const view = viewOf({
      shown: [
        { id: "clientname", value: "Ada", type: "text" },
        {
          id: "create_client_billing_splits_attorney_0",
          value: "Select attorney",
          type: "text",
        },
      ],
      actions: [
        { id: "button_save", label: "Save" },
        { id: "create_client_billing_splits_add_row", label: "Add" },
        { id: "create_client_billing_splits_remove_0", label: "Remove" },
      ],
      last: { step: "click page.button_save", ok: false, finding: "expectFailed" },
    });
    const d = decideUnleash(
      {
        view,
        stepsUsed: 4,
        writePolicy: "allow",
        recentClicks: ["button_save"],
        last: { ok: false, finding: "expectFailed" },
      },
      () => 0.5,
    );
    const text = (d.lines ?? [d.line]).join("\n");
    assert.match(text, /fill page\.create_client_billing_splits_attorney_0 /);
    assert.match(text, /click page\.button_save/);
    assert.doesNotMatch(text, /add_row|remove_0/);
  });

  it("does not treat a mapped Close create opener as Save", () => {
    assert.equal(isPrimaryFormCommit({ id: "button_close_create_client", label: "Close" }), false);
    assert.equal(isPrimaryFormCommit({ id: "button_close_create_client" }), false);
    assert.equal(isPrimaryFormCommit({ id: "button_save", label: "Save" }), true);
  });

  it("does not treat Close create as a form commit after Save was just clicked", () => {
    const view = viewOf({
      shown: [
        { id: "clientname", value: "Ada", type: "text" },
        { id: "classificationid", value: "", type: "text", required: true },
      ],
      actions: [
        { id: "button_save", label: "Save" },
        { id: "button_close_create_client", label: "Close" },
      ],
      last: { step: "click page.button_save", ok: false, finding: "expectFailed" },
    });
    const d = decideUnleash(
      {
        view,
        stepsUsed: 4,
        writePolicy: "allow",
        recentClicks: ["button_save"],
        last: { ok: false, finding: "expectFailed" },
        lockForm: "home",
      },
      () => 0.5,
    );
    const text = (d.lines ?? [d.line]).join("\n");
    assert.match(text, /click page\.button_save/);
    assert.doesNotMatch(text, /close_create/);
  });

  it("does not Cancel when lockForm pins the page", () => {
    const view = viewOf({
      shown: [{ id: "name", value: "x", type: "text" }],
      actions: [
        { id: "button_save", label: "Save" },
        { id: "button_cancel", label: "Cancel" },
      ],
    });
    const d = decideUnleash({ view, stepsUsed: 0, writePolicy: "allow", lockForm: "home" }, () => 0);
    const text = (d.lines ?? [d.line]).join("\n");
    assert.match(text, /click page\.button_save/);
    assert.doesNotMatch(text, /button_cancel/);
  });

  it("retries Save after stay, still filling empty form chips", () => {
    const view = viewOf({
      shown: [
        { id: "reference", value: "INV-1", type: "text", required: true },
        { id: "lineitems_0__matterid", value: "", type: "text" },
      ],
      actions: [{ id: "button_save", label: "Save" }],
      last: { step: "click page.button_save", ok: true },
    });
    const d = decideUnleash(
      {
        view,
        stepsUsed: 4,
        writePolicy: "allow",
        recentClicks: ["button_save"],
        last: { ok: true },
      },
      () => 0.5,
    );
    const text = (d.lines ?? [d.line]).join("\n");
    assert.match(text, /fill page\.lineitems_0__matterid /);
    assert.match(text, /click page\.button_save/);
  });

  it("stops retrying Save after the hard cap", () => {
    const view = viewOf({
      shown: [
        { id: "reference", value: "INV-1", type: "text", required: true },
        { id: "lineitems_0__matterid", value: "", type: "text" },
      ],
      actions: [{ id: "button_save", label: "Save" }],
      last: { step: "click page.button_save", ok: true },
    });
    const saves = Array.from({ length: 1 + FORM_COMMIT_RETRIES }, () => "button_save");
    const d = decideUnleash(
      {
        view,
        stepsUsed: 8,
        writePolicy: "allow",
        recentClicks: saves,
        last: { ok: true },
        lockForm: "home",
      },
      () => 0.5,
    );
    const text = (d.lines ?? [d.line]).join("\n");
    assert.doesNotMatch(text, /button_save/);
  });

  it("retries Save after a failed submit instead of hopping", () => {
    const view = viewOf({
      shown: [{ id: "reference", value: "INV-1", type: "text", required: true }],
      actions: [{ id: "button_save", label: "Save" }],
      last: { step: "click page.button_save", ok: false, finding: "expectFailed" },
    });
    const d = decideUnleash(
      {
        view,
        stepsUsed: 4,
        writePolicy: "allow",
        recentClicks: ["button_save"],
        last: { ok: false, finding: "expectFailed" },
      },
      () => 0.5,
    );
    const text = (d.lines ?? [d.line]).join("\n");
    assert.match(text, /click page\.button_save/);
    assert.doesNotMatch(text, /^open /);
  });

  it("treats a Select… chip as empty", () => {
    assert.equal(looksLikeEmptyValue({ id: "attorney", value: "Select attorney", type: "text" }), true);
    assert.equal(
      looksLikeEmptyValue({
        id: "date",
        value: "MM/DD/YYYY",
        type: "text",
        constraints: { placeholder: "MM/DD/YYYY" },
      }),
      true,
    );
    assert.equal(looksLikeEmptyValue({ id: "name", value: "Ada", type: "text" }), false);
    const view = viewOf({
      shown: [{ id: "create_client_responsible_splits_attorney_0", value: "Select attorney", type: "text", required: true }],
      actions: [{ id: "button_save", label: "Save" }],
    });
    assert.equal(formFieldsToFill(view).map((f) => f.id).join(), "create_client_responsible_splits_attorney_0");
  });

  it("fills listed *id and Select-prompt chips before Save", () => {
    const view = viewOf({
      shown: [
        { id: "party", value: "Select a party", type: "text", required: true },
        { id: "ownerid", value: "", type: "text" },
        { id: "notes", value: "ok", type: "text" },
        {
          id: "vendor",
          value: "",
          type: "text",
          constraints: { placeholder: "Search vendors" },
        },
      ],
      actions: [{ id: "button_save", label: "Save" }],
    });
    const d = decideUnleash({ view, stepsUsed: 0, writePolicy: "allow" }, () => 0.5);
    const text = (d.lines ?? [d.line]).join("\n");
    assert.match(text, /fill page\.party /);
    assert.match(text, /fill page\.ownerid /);
    assert.match(text, /fill page\.vendor /);
    assert.doesNotMatch(text, /fill page\.notes /);
    assert.match(text, /click page\.button_save/);
    const lines = text.split("\n");
    assert.ok(lines.findIndex((l) => /party/.test(l)) < lines.findIndex((l) => /button_save/.test(l)));
  });

  it("clicks Save when leftover listed rows remain after every shown field is filled", () => {
    const view = viewOf({
      shown: [
        { id: "reference", value: "INV-1", type: "text" },
        { id: "create_client_responsible_splits_attorney_0", value: "Hannah Kim", type: "text" },
      ],
      actions: [
        { id: "option_hannah_kim", role: "option", label: "Hannah Kim" },
        { id: "button_save", label: "Save" },
      ],
    });
    const d = decideUnleash(
      { view, stepsUsed: 3, writePolicy: "allow", formHits: { "home/page": 2 } },
      () => 0.5,
    );
    assert.equal(d.mode, "form");
    const text = (d.lines ?? [d.line]).join("\n");
    assert.equal(text, "click page.button_save");
    assert.doesNotMatch(text, /option_/);
  });

  it("clicks Save before Submit when both are live", () => {
    assert.equal(commitKindRank({ id: "button_save", label: "Save" }), 0);
    assert.equal(commitKindRank({ id: "button_submit", label: "Submit" }), 2);
    const view = viewOf({
      shown: [{ id: "name", value: "", type: "text" }],
      actions: [
        { id: "button_submit", label: "Submit" },
        { id: "button_save", label: "Save" },
      ],
    });
    const d = decideUnleash({ view, stepsUsed: 0, writePolicy: "allow" }, () => 0.5);
    const text = (d.lines ?? [d.line]).join("\n");
    assert.match(text, /fill page\.name /);
    assert.match(text, /click page\.button_save/);
    assert.doesNotMatch(text, /button_submit/);
  });

  it("clicks mapped Save even when the live control is disabled and missing from the view", () => {
    const view = viewOf({
      shown: [
        { id: "legalname", value: "", type: "text" },
        { id: "notes", value: "", type: "text" },
      ],
      actions: [{ id: "tab_dashboard", role: "tab", label: "Dashboard" }],
    });
    const pages = [
      {
        id: "home",
        path: "/",
        ready: { by: "testId", value: "home" },
        surfaces: [
          {
            id: "page",
            kind: "page" as const,
            fields: [],
            actions: [{ id: "button_save", by: "testId" as const, value: "save", status: "ok" as const }],
          },
        ],
      },
    ] as unknown as Page[];
    assert.equal(mappedPrimaryCommits(view, pages)[0]?.id, "button_save");
    const d = decideUnleash({ view, stepsUsed: 0, writePolicy: "allow", pages }, () => 0.5);
    assert.equal(d.mode, "form");
    const text = (d.lines ?? [d.line]).join("\n");
    assert.match(text, /fill page\.legalname /);
    assert.match(text, /click page\.button_save/);
    assert.doesNotMatch(text, /tab_dashboard/);
  });
});

describe("repeating child rows", () => {
  it("reads bracket, dunder, and row_N ids and ignores 1099-style numbers", () => {
    assert.equal(repeatingRowIndex("items[0].name"), 0);
    assert.equal(repeatingRowIndex("items[2].qty"), 2);
    assert.equal(repeatingRowIndex("lineitems_0__amount"), 0);
    assert.equal(repeatingRowIndex("lineitems_1__description"), 1);
    assert.equal(repeatingRowIndex("row_0_qty"), 0);
    assert.equal(repeatingRowIndex("split_row-3_amount"), 3);
    assert.equal(repeatingRowIndex("invoice_1099_tax"), undefined);
    assert.equal(repeatingRowIndex("f12"), undefined);
    assert.equal(skipRepeatingChildField("lineitems_0__amount"), false);
    assert.equal(skipRepeatingChildField("lineitems_1__amount"), true);
    assert.equal(skipRepeatingChildField("invoice_1099_tax"), false);
  });

  it("counts existing repeating rows and hides Add Line once one exists", () => {
    assert.equal(isAddRepeatingRowAction({ id: "button_add_line", label: "Add Line" }), true);
    assert.equal(isAddRepeatingRowAction({ id: "create_client_billing_splits_add_row" }), true);
    assert.equal(isAddRepeatingRowAction({ id: "add_bank_account", label: "Add bank account" }), false);
    assert.equal(
      repeatingRowCount(
        viewOf({
          shown: [
            { id: "name", value: "", type: "text" },
            { id: "lineitems_0__amount", value: "", type: "text" },
            { id: "lineitems_1__amount", value: "", type: "text" },
          ],
        }),
      ),
      2,
    );
    const withRow = viewOf({
      shown: [{ id: "lineitems_0__amount", value: "", type: "text" }],
      actions: [
        { id: "button_add_line", label: "Add Line" },
        { id: "submit", label: "Save" },
      ],
    });
    assert.deepEqual(
      stayActions(withRow).map((a) => a.id),
      ["submit"],
    );
    const noRow = viewOf({
      shown: [{ id: "name", value: "", type: "text" }],
      actions: [
        { id: "button_add_line", label: "Add Line" },
        { id: "submit", label: "Save" },
      ],
    });
    assert.deepEqual(
      stayActions(noRow).map((a) => a.id).sort(),
      ["button_add_line", "submit"],
    );
  });

  it("hides tab chrome while a create form is still mid-fill", () => {
    const view = viewOf({
      shown: [
        { id: "legalname", value: "Todd Turner", type: "text" },
        { id: "industry", value: "", type: "text" },
      ],
      actions: [
        { id: "tab_dashboard", role: "tab", label: "Dashboard" },
        { id: "button_active_tabs__6", label: "Active tabs" },
        { id: "button_save", label: "Save" },
      ],
    });
    assert.deepEqual(
      stayActions(view).map((a) => a.id),
      ["button_save"],
    );
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
    assert.equal(looksLikeSearchField({ id: "vendortype_search", value: "", type: "text" }), true);
    assert.equal(looksLikeSearchField({ id: "clientname", value: "", type: "text" }), false);
    assert.equal(looksLikeSearchField({ id: "findings", value: "", type: "text" }), false);
  });
});

describe("looksLikePageSearch", () => {
  it("is Lois or a bare search box, not a form body *_search", () => {
    assert.equal(looksLikePageSearch({ id: "search", value: "", type: "text" }), true);
    assert.equal(looksLikePageSearch({ id: "q", value: "", type: "text" }), true);
    assert.equal(looksLikePageSearch({ id: "textbox_search_or_talk_to_lois", value: "", type: "text" }), true);
    assert.equal(looksLikePageSearch({ id: "vendortype_search", value: "", type: "text" }), false);
    assert.equal(looksLikePageSearch({ id: "vendor_create_places_search", value: "", type: "text" }), false);
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
