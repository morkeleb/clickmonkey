import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clickKey,
  clickWasNoop,
  commitKindRank,
  decideMap,
  decideUnleash,
  formSubmitAction,
  isAuthGateHref,
  isAuthGatePage,
  needsLeashReentry,
  isPrimaryFormCommit,
  looksLikeModeSwitch,
  freshClicks,
  isAddRepeatingRowAction,
  listModeScore,
  looksLikeSearchField,
  looksLikePageSearch,
  looksLikeListFilterField,
  looksLikeGridCellCheckbox,
  looksLikeRangeStart,
  looksLikeRangeEnd,
  looksLikeRowSelectCheckbox,
  looksLikeHeaderSelectCheckbox,
  looksLikeDataRowSelectCheckbox,
  mappedPrimaryCommits,
  pickSelectOption,
  pickDataRowSelectToCheck,
  planFormBurstFills,
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
  looksLikeMidForm,
  continueFormBurst,
  formFieldsToFill,
  FORM_COMMIT_RETRIES,
  stayActions,
  viewWidgetSig,
} from "../src/brains/unleash.js";
import { skipInspectForBurstLine } from "../src/brains/types.js";
import type { Page } from "../src/schema/page-model.js";
import { fogHunger, FOG_FRESH_MS, FOG_OLD_MS, npcHunger } from "../src/brains/npc.js";
import { detectWalkerMode } from "../src/brains/walker-mode.js";
import { parseLine } from "../src/schema/dsl.js";
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

function burstFillValue(lines: readonly string[], id: string): string {
  for (const line of lines) {
    const step = parseLine(line);
    if (step && "kind" in step && step.kind === "fill" && step.id === id) return step.value;
  }
  throw new Error(`no fill for ${id} in ${lines.join(" | ")}`);
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
    assert.equal(looksLikeListedPicker({ id: "vendor", value: "", type: "text" }), true);
    assert.equal(looksLikeListedPicker({ id: "attorney", value: "", type: "text" }), true);
    assert.equal(looksLikeListedPicker({ id: "attorney", value: "Select attorney", type: "text" }), true);
    assert.equal(looksLikeListedPicker({ id: "vendortype_search", value: "", type: "text" }), true);
    assert.equal(
      looksLikeListedPicker({ id: "vendor", value: "", type: "text", constraints: { placeholder: "Search vendors" } }),
      true,
    );
    assert.equal(looksLikeListedPicker({ id: "industry", value: "", type: "text" }), false);
    const d = decideUnleash({ view, stepsUsed: 0, writePolicy: "allow" }, () => 0.5);
    const text = (d.lines ?? [d.line]).join("\n");
    assert.match(text, /fill page\.vendorid /);
    assert.match(burstFillValue(d.lines ?? [d.line], "vendorid"), /^[ae]$/);
    assert.match(burstFillValue(d.lines ?? [d.line], "lineitems_0__matterid"), /^[ae]$/);
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
    assert.match(burstFillValue(d.lines ?? [d.line], "vendortype_search"), /^[ae]$/);
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

  it("does not treat Existing/Create-new mode toggles as Save", () => {
    assert.equal(looksLikeModeSwitch({ id: "wizard_source_mode_create", label: "Create new" }), true);
    assert.equal(looksLikeModeSwitch({ id: "wizard_source_mode_pick", label: "Existing" }), true);
    assert.equal(looksLikeModeSwitch({ id: "button_create", label: "Create" }), false);
    assert.equal(isPrimaryFormCommit({ id: "wizard_source_mode_create", label: "Create new" }), false);
    assert.equal(isPrimaryFormCommit({ id: "wizard_source_mode_pick", label: "Existing" }), false);
    assert.equal(isPrimaryFormCommit({ id: "button_create", label: "Create" }), true);
    assert.equal(
      formSubmitAction([
        { id: "wizard_source_mode_create", label: "Create new" },
        { id: "wizard_next", label: "Next" },
      ])?.id,
      "wizard_next",
    );
  });

  it("does not treat Add/Create that opens a dialog as Save", () => {
    const page = {
      surfaces: [{ id: "add_customer", kind: "dialog" as const, fields: [], actions: [] }],
    };
    assert.equal(
      isPrimaryFormCommit({ id: "customers_action_customer_create", opens: "add_customer" }, page, "page"),
      false,
    );
    assert.equal(isPrimaryFormCommit({ id: "button_create", label: "Create", opens: "add_customer" }, page, "add_customer"), true);
    assert.equal(
      isPrimaryFormCommit({ id: "form_dialog_customer_create_submit", opens: "customers_id1" }, page, "add_customer"),
      true,
    );
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

  it("treats some filled body fields plus empties as mid-form", () => {
    assert.equal(
      looksLikeMidForm(
        viewOf({
          shown: [
            { id: "vendor", value: "Acme", type: "text" },
            { id: "gl", value: "6000", type: "text" },
            { id: "office", value: "Oslo", type: "text" },
            { id: "row_0_account", value: "", type: "text" },
          ],
        }),
      ),
      true,
    );
    assert.equal(
      looksLikeMidForm(
        viewOf({
          shown: [
            { id: "vendor", value: "Acme", type: "text" },
            { id: "office", value: "Select office", type: "text" },
          ],
        }),
      ),
      true,
    );
    assert.equal(
      looksLikeMidForm(viewOf({ shown: [{ id: "vendor", value: "Acme", type: "text" }] })),
      false,
    );
    assert.equal(
      looksLikeMidForm(viewOf({ shown: [{ id: "vendor", value: "", type: "text" }] })),
      false,
    );
  });

  it("clicks Save after a listed fill miss instead of opening another page", () => {
    const view = viewOf({
      page: "invoices_new",
      pages: ["home", "invoices_new", "settings"],
      shown: [
        { id: "vendor", value: "Acme", type: "text" },
        { id: "gl", value: "6000", type: "text" },
        { id: "office", value: "Oslo", type: "text" },
        { id: "row_0_account", value: "Select account", type: "text" },
      ],
      actions: [
        { id: "button_save", label: "Save" },
        { id: "link_settings", nav: true, opens: "settings" },
      ],
      last: { step: "fill page.row_0_account Acme", ok: false },
    });
    const pages = [
      {
        id: "invoices_new",
        path: "/invoices/new",
        ready: { by: "testId", value: "invoices_new" },
        surfaces: [
          {
            id: "page",
            kind: "page" as const,
            fields: [],
            actions: [],
          },
        ],
      },
      {
        id: "settings",
        path: "/settings",
        ready: { by: "testId", value: "settings" },
        surfaces: [
          {
            id: "page",
            kind: "page" as const,
            fields: [{ id: "name", required: false, type: "text" as const, by: "name" as const, value: "name", status: "ok" as const }],
            actions: [{ id: "submit", by: "testId" as const, value: "submit", status: "ok" as const }],
          },
        ],
      },
    ] as unknown as Page[];
    const d = decideUnleash(
      { view, stepsUsed: 4, writePolicy: "allow", pages, last: { ok: false } },
      () => 0.5,
    );
    const text = (d.lines ?? [d.line]).join("\n");
    assert.equal(d.mode, "form");
    assert.equal(looksLikeMidForm(view), true);
    assert.match(text, /click page\.button_save/);
    assert.doesNotMatch(text, /^open /);
    assert.notEqual(d.note, "form hunt");
  });

  it("keeps Save as the last burst line even when an earlier listed fill is in the burst", () => {
    const view = viewOf({
      shown: [
        { id: "vendor", value: "", type: "text", required: true },
        { id: "gl", value: "", type: "text" },
        { id: "office", value: "", type: "text" },
        { id: "row_0_account", value: "", type: "text" },
      ],
      actions: [{ id: "button_save", label: "Save" }],
    });
    const d = decideUnleash({ view, stepsUsed: 0, writePolicy: "allow" }, () => 0.5);
    const lines = d.lines ?? [d.line];
    assert.ok(lines.some((l) => l.startsWith("fill page.vendor ")));
    assert.ok(lines.some((l) => l.startsWith("fill page.row_0_account ")));
    assert.equal(lines.at(-1), "click page.button_save");
    assert.doesNotMatch(lines.join("\n"), /^open /m);
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

  it("does not treat page-level list_action_create as the dialog Save", () => {
    const pages = [
      {
        id: "customers",
        path: "/customers",
        ready: { by: "testId", value: "customers" },
        surfaces: [
          {
            id: "page",
            kind: "page" as const,
            fields: [],
            actions: [
              {
                id: "list_action_create",
                by: "testId" as const,
                value: "list-action-create",
                status: "ok" as const,
              },
              {
                id: "customers_action_customer_create",
                by: "testId" as const,
                value: "customers-action-customer-create",
                opens: "add_customer",
                status: "ok" as const,
              },
            ],
          },
          {
            id: "add_customer",
            kind: "dialog" as const,
            fields: [
              { id: "name", required: true, type: "text" as const, by: "name" as const, value: "name", status: "ok" as const },
              { id: "notes", required: false, type: "textarea" as const, by: "name" as const, value: "notes", status: "ok" as const },
            ],
            actions: [
              {
                id: "form_dialog_customer_create_submit",
                by: "testId" as const,
                value: "form-dialog-customer-create-submit",
                opens: "customers_id1",
                status: "ok" as const,
              },
            ],
          },
        ],
      },
    ] as unknown as Page[];
    const view = viewOf({
      page: "customers",
      surface: "add_customer",
      stack: ["page", "add_customer"],
      shown: [
        { id: "name", value: "", type: "text" },
        { id: "notes", value: "", type: "text" },
      ],
      actions: [{ id: "button_cancel", label: "Cancel" }],
    });
    assert.deepEqual(
      mappedPrimaryCommits(view, pages).map((a) => a.id),
      ["form_dialog_customer_create_submit"],
    );
    const d = decideUnleash({ view, stepsUsed: 0, writePolicy: "allow", pages }, () => 0.5);
    assert.equal(d.mode, "form");
    const text = (d.lines ?? [d.line]).join("\n");
    assert.match(text, /fill add_customer\.name /);
    assert.match(text, /fill add_customer\.notes /);
    assert.match(text, /click add_customer\.form_dialog_customer_create_submit/);
    assert.doesNotMatch(text, /list_action_create|customers_action_customer_create/);
  });
});

describe("skipInspectForBurstLine", () => {
  it("inspects a single line, and only the last line of a fill+fill+Create burst", () => {
    assert.equal(skipInspectForBurstLine(0, 1), false);
    assert.equal(skipInspectForBurstLine(0, 3), true);
    assert.equal(skipInspectForBurstLine(1, 3), true);
    assert.equal(skipInspectForBurstLine(2, 3), false);
  });
});

describe("continueFormBurst", () => {
  it("keeps a form burst going after a listed fill miss, but aborts on crash or bounce", () => {
    assert.equal(continueFormBurst("fill", { ok: false, findingKind: "expectFailed" }), true);
    assert.equal(continueFormBurst("fill", { ok: true }), true);
    assert.equal(continueFormBurst("click", { ok: true }), true);
    assert.equal(continueFormBurst("click", { ok: false, findingKind: "expectFailed" }), false);
    assert.equal(continueFormBurst("fill", { ok: false, findingKind: "pageError" }), false);
    assert.equal(continueFormBurst("fill", { ok: false, bounced: true }), false);
    assert.equal(continueFormBurst("open", { ok: true }), true);
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
    assert.equal(plausibleFill({ id: "vendorid", value: "", type: "text" }, () => 0, false), "a");
    assert.match(plausibleFill({ id: "due_from", value: "", type: "text" }, () => 0.3, false), /^\d{4}-\d{2}-\d{2}$/);
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
    assert.equal(looksLikePageSearch({ id: "customers_filter_q", value: "", type: "text" }), true);
    assert.equal(looksLikePageSearch({ id: "customer_filter_q", value: "", type: "text" }), true);
    assert.equal(looksLikePageSearch({ id: "vendortype_search", value: "", type: "text" }), false);
    assert.equal(looksLikePageSearch({ id: "vendor_create_places_search", value: "", type: "text" }), false);
  });
});

describe("looksLikeListFilterField", () => {
  it("is list status/period chrome, not a form body status", () => {
    assert.equal(looksLikeListFilterField({ id: "afa_list_status" }), true);
    assert.equal(looksLikeListFilterField({ id: "list_status" }), true);
    assert.equal(looksLikeListFilterField({ id: "combobox_switch_period" }), true);
    assert.equal(looksLikeListFilterField({ id: "switch_period" }), true);
    assert.equal(looksLikeListFilterField({ id: "status" }), false);
    assert.equal(looksLikeListFilterField({ id: "vendor_status" }), false);
    assert.equal(looksLikeListFilterField({ id: "period" }), false);
    assert.equal(looksLikeListFilterField({ id: "billing_period" }), false);
  });

  it("does not treat list filters as form body fields", () => {
    const view = viewOf({
      shown: [
        { id: "afa_list_status", value: "", type: "select" },
        { id: "combobox_switch_period", value: "", type: "combobox" },
        { id: "status", value: "", type: "select" },
        { id: "name", value: "", type: "text" },
      ],
      actions: [{ id: "button_save", label: "Save" }],
    });
    assert.deepEqual(formFieldsToFill(view).map((f) => f.id), ["status", "name"]);
  });
});

describe("looksLikeGridCellCheckbox", () => {
  it("skips a cluster of cell-keyed checkboxes and keeps a single settings toggle", () => {
    const grid = [
      { id: "checkbox_active_for_a102", value: "false", type: "checkbox" as const },
      { id: "checkbox_active_for_a103", value: "false", type: "checkbox" as const },
      { id: "checkbox_active_for_a104", value: "false", type: "checkbox" as const },
      { id: "checkbox_active_for_a105", value: "false", type: "checkbox" as const },
    ];
    assert.equal(looksLikeGridCellCheckbox(grid[0]!, grid), true);
    const view = viewOf({
      shown: [...grid, { id: "checkbox_active", value: "false", type: "checkbox" }],
      actions: [{ id: "button_save", label: "Save" }],
    });
    assert.deepEqual(formFieldsToFill(view).map((f) => f.id), ["checkbox_active"]);
    const terms = viewOf({
      shown: [{ id: "agree", value: "false", type: "checkbox", label: "I agree" }],
      actions: [{ id: "submit" }],
    });
    assert.deepEqual(formFieldsToFill(terms).map((f) => f.id), ["agree"]);
  });
});

describe("listed fill retry", () => {
  it("skips a listed picker already tried this stay so empty chips do not loop", () => {
    const view = viewOf({
      shown: [
        { id: "clientid", value: "MCP Test Client", type: "text" },
        { id: "matterid", value: "", type: "text" },
        { id: "sourcecitation", value: "hello", type: "text" },
      ],
      actions: [{ id: "ocg_upload_submit", label: "Submit" }],
    });
    assert.deepEqual(formFieldsToFill(view).map((f) => f.id), ["matterid"]);
    assert.deepEqual(
      formFieldsToFill(view, { fillTried: { matterid: true } }).map((f) => f.id),
      [],
    );
    const d = decideUnleash(
      { view, stepsUsed: 4, writePolicy: "allow", fillTried: { matterid: true } },
      () => 0.5,
    );
    const text = (d.lines ?? [d.line]).join("\n");
    assert.doesNotMatch(text, /fill page\.matterid/);
    assert.match(text, /click page\.ocg_upload_submit/);
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

describe("date range burst", () => {
  it("matches generic from/to tokens on date fields, not a name", () => {
    assert.equal(looksLikeRangeStart({ id: "due_from", type: "date" }), true);
    assert.equal(looksLikeRangeEnd({ id: "due_to", type: "date" }), true);
    assert.equal(looksLikeRangeStart({ id: "from_date", type: "date" }), true);
    assert.equal(looksLikeRangeEnd({ id: "to_date", type: "date" }), true);
    assert.equal(looksLikeRangeStart({ id: "start_date", type: "date" }), true);
    assert.equal(looksLikeRangeEnd({ id: "end_date", type: "date" }), true);
    assert.equal(looksLikeRangeStart({ id: "min_date", type: "date" }), true);
    assert.equal(looksLikeRangeEnd({ id: "max_date", type: "date" }), true);
    assert.equal(looksLikeRangeStart({ id: "name", type: "text" }), false);
    assert.equal(looksLikeRangeEnd({ id: "amount", type: "number" }), false);
    assert.equal(looksLikeRangeEnd({ id: "toledo", type: "text" }), false);
    assert.equal(looksLikeRangeEnd({ id: "toledo", type: "date" }), false);
  });

  it("clamps an inverted due_to onto due_from when planning a burst", () => {
    const planned = planFormBurstFills(
      [
        { id: "due_from", value: "", type: "date" },
        { id: "due_to", value: "", type: "date" },
      ],
      (field) => (looksLikeRangeStart(field) ? "2026-06-23" : "2026-06-20"),
    );
    const from = planned.find((p) => p.field.id === "due_from")?.value;
    const to = planned.find((p) => p.field.id === "due_to")?.value;
    assert.equal(from, "2026-06-23");
    assert.ok(from && to && from <= to, `from ${from} should be <= to ${to}`);
    assert.equal(
      planned.map((p) => p.field.id).join(),
      "due_from,due_to",
      "start field is filled before end",
    );
  });

  it("fills due_from <= due_to in one allow burst for rng 0 and 0.5", () => {
    const view = viewOf({
      shown: [
        { id: "due_from", value: "", type: "date" },
        { id: "due_to", value: "", type: "date" },
      ],
      actions: [{ id: "button_submit", label: "Submit" }],
    });
    for (const rng of [() => 0, () => 0.5] as const) {
      const d = decideUnleash({ view, stepsUsed: 0, writePolicy: "allow" }, rng);
      const lines = d.lines ?? [d.line];
      const from = burstFillValue(lines, "due_from");
      const to = burstFillValue(lines, "due_to");
      assert.match(from, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(to, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(from <= to, `from ${from} should be <= to ${to}`);
      assert.ok(lines.findIndex((l) => /due_from/.test(l)) < lines.findIndex((l) => /due_to/.test(l)));
      assert.equal(lines.at(-1), "click page.button_submit");
    }
  });

  it("clamps a masked MM/DD/YYYY due_to onto due_from", () => {
    const planned = planFormBurstFills(
      [
        {
          id: "due_from",
          value: "",
          type: "text",
          constraints: { placeholder: "MM/DD/YYYY" },
        },
        {
          id: "due_to",
          value: "",
          type: "text",
          constraints: { placeholder: "MM/DD/YYYY" },
        },
      ],
      (field) => (looksLikeRangeStart(field) ? "06/23/2026" : "06/20/2026"),
    );
    const from = planned.find((p) => p.field.id === "due_from")?.value;
    const to = planned.find((p) => p.field.id === "due_to")?.value;
    assert.equal(from, "06/23/2026");
    assert.equal(to, "06/23/2026");
  });
});

describe("row-select burst", () => {
  it("skips header/select-all in formFieldsToFill and does not random-fill it", () => {
    assert.equal(
      looksLikeHeaderSelectCheckbox({ id: "checkbox_column_with_header_selection", type: "checkbox" }),
      true,
    );
    assert.equal(looksLikeDataRowSelectCheckbox({ id: "checkbox_column_with_header_selection", type: "checkbox" }), false);
    const view = viewOf({
      shown: [
        { id: "checkbox_column_with_header_selection", value: "false", type: "checkbox" },
        { id: "name", value: "", type: "text" },
      ],
      actions: [{ id: "button_submit", label: "Submit" }],
    });
    assert.deepEqual(
      formFieldsToFill(view).map((f) => f.id),
      ["name"],
    );
    const d = decideUnleash({ view, stepsUsed: 0, writePolicy: "allow" }, () => 0.9);
    const text = (d.lines ?? [d.line]).join("\n");
    assert.doesNotMatch(text, /checkbox_column_with_header_selection/);
    assert.match(text, /fill page\.name /);
    assert.match(text, /click page\.button_submit/);
  });

  it("checks one data-row checkbox true on a submit form and leaves others skipped", () => {
    const view = viewOf({
      shown: [
        { id: "name", value: "", type: "text" },
        { id: "checkbox_column_with_header_selection", value: "false", type: "checkbox" },
        {
          id: "checkbox_press_space_to_toggle_row_selection__unchecked_",
          value: "false",
          type: "checkbox",
          label: "Press Space to toggle row selection (unchecked)",
        },
        { id: "checkbox_press_space_to_toggle_row_selection__row_1", value: "false", type: "checkbox" },
      ],
      actions: [{ id: "button_submit", label: "Submit" }],
    });
    assert.equal(
      formFieldsToFill(view).some((f) => looksLikeRowSelectCheckbox(f)),
      false,
    );
    const picked = pickDataRowSelectToCheck(view.shown);
    assert.equal(picked?.id, "checkbox_press_space_to_toggle_row_selection__unchecked_");
    const d = decideUnleash({ view, stepsUsed: 0, writePolicy: "allow" }, () => 0.9);
    const lines = d.lines ?? [d.line];
    const text = lines.join("\n");
    const rowFills = lines.filter((l) => /toggle_row_selection/.test(l));
    assert.equal(rowFills.length, 1);
    assert.equal(burstFillValue(lines, "checkbox_press_space_to_toggle_row_selection__unchecked_"), "true");
    assert.doesNotMatch(text, /header_selection/);
    assert.doesNotMatch(text, /row_1/);
    assert.equal(lines.at(-1), "click page.button_submit");
  });

  it("still fills a terms checkbox as a normal checkbox", () => {
    const view = viewOf({
      shown: [{ id: "agree", value: "false", type: "checkbox", label: "I agree" }],
      actions: [{ id: "submit" }],
    });
    assert.deepEqual(
      formFieldsToFill(view).map((f) => f.id),
      ["agree"],
    );
    const on = decideUnleash({ view, stepsUsed: 0, writePolicy: "allow" }, () => 0);
    const off = decideUnleash({ view, stepsUsed: 0, writePolicy: "allow" }, () => 0.9);
    assert.equal(burstFillValue(on.lines ?? [on.line], "agree"), "true");
    assert.equal(burstFillValue(off.lines ?? [off.line], "agree"), "false");
  });

  it("skips row-select when the table is empty (no data-row checkbox shown)", () => {
    const view = viewOf({
      shown: [
        { id: "due_from", value: "", type: "date" },
        { id: "checkbox_column_with_header_selection", value: "false", type: "checkbox" },
      ],
      actions: [{ id: "button_submit", label: "Submit" }],
    });
    assert.equal(pickDataRowSelectToCheck(view.shown), undefined);
    const d = decideUnleash({ view, stepsUsed: 0, writePolicy: "allow" }, () => 0.5);
    const text = (d.lines ?? [d.line]).join("\n");
    assert.doesNotMatch(text, /checkbox_/);
    assert.match(text, /click page\.button_submit/);
  });
});

describe("isAuthGatePage", () => {
  it("matches login/SSO rooms and paths, not app pages", () => {
    assert.equal(isAuthGatePage("login"), true);
    assert.equal(isAuthGatePage("u_login"), true);
    assert.equal(isAuthGatePage("sign_in"), true);
    assert.equal(isAuthGatePage("logout"), true);
    assert.equal(isAuthGatePage("settings"), false);
    assert.equal(isAuthGatePage("auth_settings"), false);
    assert.equal(isAuthGatePage("auth"), true);
    assert.equal(isAuthGatePage("home", [{ id: "home", path: "/login" }]), true);
    assert.equal(isAuthGatePage("home", [{ id: "home", path: "/auth/tokens" }]), false);
    assert.equal(isAuthGatePage("home", [{ id: "home", path: "/" }]), false);
    assert.equal(isAuthGateHref("https://app.example/u/logout"), true);
    assert.equal(isAuthGateHref("https://app.example/auth/tokens"), false);
    assert.equal(isAuthGateHref("https://app.example/auth/login"), true);
    assert.equal(needsLeashReentry("clients", "https://app.example/login"), true);
    assert.equal(needsLeashReentry("clients", "https://app.example/clients"), false);
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
