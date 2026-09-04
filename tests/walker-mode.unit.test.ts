import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideUnleash, isEmptyStateAction, isTabAction, legalUnleashActions, listLooksPopulated } from "../src/brains/unleash.js";
import type { BrainContext } from "../src/brains/types.js";
import {
  detectWalkerMode,
  isFormCommitNote,
  isFormWorkNote,
  lineMatchesMode,
  shouldStampMode,
  UNLEASH_MODES,
} from "../src/brains/walker-mode.js";
import type { Page } from "../src/schema/page-model.js";
import { formatExploreVisit } from "../src/schema/visit.js";
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

function burstText(ctx: BrainContext, rng: () => number): string {
  const d = decideUnleash(ctx, rng);
  return (d.lines ?? [d.line]).join("\n");
}

describe("walker modes", () => {
  it("lists wizard then form then list then tab then dialog then empty then nav", () => {
    assert.deepEqual(
      UNLEASH_MODES.map((m) => m.name),
      ["wizard", "form", "list", "tab", "dialog", "empty", "nav"],
    );
  });

  it("detects form in a dialog with fields and Create + Cancel (self-opens ok)", () => {
    const view = viewOf({
      page: "customers",
      surface: "add_customer",
      stack: ["page", "add_customer"],
      shown: [
        { id: "name", value: "", type: "text" },
        { id: "notes", value: "", type: "text" },
      ],
      actions: [
        { id: "button_cancel", label: "Cancel", opens: "add_customer" },
        { id: "button_create", label: "Create", opens: "add_customer" },
      ],
    });
    const ctx = { view, stepsUsed: 0 };
    assert.equal(detectWalkerMode(ctx).name, "form");
    const d = decideUnleash(ctx, () => 0.5);
    assert.equal(d.mode, "form");
  });

  it("detects form on a page with fields, Submit, and writePolicy allow", () => {
    const view = viewOf({
      shown: [{ id: "name", value: "", type: "text" }],
      actions: [{ id: "submit" }],
    });
    const ctx: BrainContext = { view, stepsUsed: 0, writePolicy: "allow" };
    assert.equal(detectWalkerMode(ctx).name, "form");
    const d = decideUnleash(ctx, () => 0.5);
    assert.equal(d.mode, "form");
    assert.match((d.lines ?? []).join("\n"), /click page\.submit/);
  });

  it("detects form on a page with fields and Submit under validationOnly, and fills only", () => {
    const view = viewOf({
      shown: [{ id: "name", value: "", type: "text" }],
      actions: [{ id: "submit" }],
    });
    const ctx: BrainContext = { view, stepsUsed: 0, writePolicy: "validationOnly" };
    assert.equal(detectWalkerMode(ctx).name, "form");
    const d = decideUnleash(ctx, () => 0.5);
    assert.equal(d.mode, "form");
    const text = (d.lines ?? [d.line]).join("\n");
    assert.match(text, /^fill page\.name /);
    assert.doesNotMatch(text, /click /);
  });

  it("does not treat Create your first as submit, and does not fill search then click it", () => {
    const empty = viewOf({
      page: "fees_and_cost_fee_entries",
      shown: [{ id: "search", value: "", type: "text", label: "Search" }],
      actions: [
        { id: "button_create_your_first_fee_entry", label: "Create your first fee entry" },
        { id: "button_new_fee_entry", label: "New fee entry" },
        { id: "button_add_filter", label: "Add filter" },
      ],
      pages: ["home", "fees_and_cost_fee_entries"],
    });
    assert.notEqual(detectWalkerMode({ view: empty, stepsUsed: 0, writePolicy: "allow" }).name, "form");
    const first = decideUnleash({ view: empty, stepsUsed: 0, writePolicy: "allow" }, () => 0.5);
    const firstText = (first.lines ?? [first.line]).join("\n");
    assert.doesNotMatch(firstText, /fill page\.search/);

    const filtered = viewOf({
      ...empty,
      shown: [{ id: "search", value: "aeger", type: "text", label: "Search" }],
    });
    const after = decideUnleash({ view: filtered, stepsUsed: 1, writePolicy: "allow" }, () => 0.5);
    const afterText = (after.lines ?? [after.line]).join("\n");
    assert.doesNotMatch(afterText, /button_create_your_first_fee_entry/);
  });

  it("does not fill a row-selection checkbox when the table is a list", () => {
    const view = viewOf({
      shown: [
        {
          id: "checkbox_press_space_to_toggle_row_selection__unchecked_",
          value: "",
          type: "checkbox",
          label: "Press Space to toggle row selection (unchecked)",
        },
        { id: "search", value: "", type: "text", label: "Search" },
      ],
      actions: [
        { id: "button_previous" },
        { id: "button_next" },
        { id: "combobox_status", role: "combobox" },
      ],
    });
    const ctx = { view, stepsUsed: 0, writePolicy: "allow" as const };
    assert.equal(detectWalkerMode(ctx).name, "list");
    const d = decideUnleash(ctx, () => 0.5);
    const text = (d.lines ?? [d.line]).join("\n");
    assert.doesNotMatch(text, /toggle_row_selection/);
  });

  it("checks one data-row checkbox on a batch submit form", () => {
    const view = viewOf({
      shown: [
        {
          id: "checkbox_press_space_to_toggle_row_selection__unchecked_",
          value: "false",
          type: "checkbox",
          label: "Press Space to toggle row selection (unchecked)",
        },
      ],
      actions: [{ id: "button_submit", label: "Submit" }],
    });
    const ctx = { view, stepsUsed: 0, writePolicy: "allow" as const };
    assert.equal(detectWalkerMode(ctx).name, "form");
    const text = burstText(ctx, () => 0.9);
    assert.match(text, /fill page\.checkbox_press_space_to_toggle_row_selection__unchecked_ true/);
    assert.match(text, /click page\.button_submit/);
  });

  it("detects nav on a page with a search field and an Add customer opener", () => {
    const view = viewOf({
      shown: [{ id: "q", value: "", type: "text" }],
      actions: [{ id: "button_add_customer", label: "Add customer", opens: "add_customer" }],
    });
    const ctx = { view, stepsUsed: 0 };
    assert.equal(detectWalkerMode(ctx).name, "nav");
    const d = decideUnleash(ctx, () => 0.5);
    assert.equal(d.mode, "nav");
  });

  it("does not lock form mode on a list search plus Create dialog opener", () => {
    const pages: Page[] = [
      {
        id: "customers",
        path: "/customers",
        params: [],
        ready: { by: "testId", value: "customers" },
        surfaces: [
          {
            id: "page",
            kind: "page",
            fields: [
              {
                id: "customers_filter_q",
                required: false,
                type: "text",
                by: "testId",
                value: "customers-filter-q",
                status: "ok",
              },
            ],
            actions: [
              {
                id: "customers_action_customer_create",
                by: "testId",
                value: "customers-action-customer-create",
                opens: "add_customer",
                status: "ok",
              },
              {
                id: "customers_row_1",
                by: "testId",
                value: "customers-row-1",
                status: "ok",
              },
            ],
          },
          {
            id: "add_customer",
            kind: "dialog",
            fields: [
              { id: "name", required: true, type: "text", by: "name", value: "name", status: "ok" },
              { id: "notes", required: false, type: "textarea", by: "name", value: "notes", status: "ok" },
            ],
            actions: [
              {
                id: "form_dialog_customer_create_submit",
                by: "testId",
                value: "form-dialog-customer-create-submit",
                opens: "customers_id1",
                status: "ok",
              },
            ],
          },
        ],
      },
    ];
    const view = viewOf({
      page: "customers",
      pages: ["customers"],
      shown: [{ id: "customers_filter_q", value: "", type: "text", label: "Search" }],
      actions: [
        { id: "customers_action_customer_create", opens: "add_customer" },
        { id: "customers_row_1" },
        { id: "customers_filter_status", role: "combobox" },
      ],
    });
    const ctx: BrainContext = { view, stepsUsed: 0, writePolicy: "allow", pages };
    assert.notEqual(detectWalkerMode(ctx).name, "form");
    const d = decideUnleash(ctx, () => 0);
    const text = (d.lines ?? [d.line]).join("\n");
    assert.doesNotMatch(text, /fill page\.customers_filter_q/);
    assert.notEqual(d.mode, "form");
    assert.match(text, /click page\.(customers_action_customer_create|customers_filter_status|customers_row_1)/);
  });

  it("detects nav when there are no fields and a stay button", () => {
    const view = viewOf({
      actions: [{ id: "button_expand" }],
    });
    const ctx = { view, stepsUsed: 0 };
    assert.equal(detectWalkerMode(ctx).name, "nav");
    const d = decideUnleash(ctx);
    assert.equal(d.mode, "nav");
    assert.equal(d.line, "click page.button_expand");
  });

  it("detects nav and hops when only chrome remains", () => {
    const view = viewOf({
      page: "home",
      pages: ["home", "about"],
      actions: [
        { id: "link_home", nav: true, opens: "home" },
        { id: "link_about", nav: true, opens: "about" },
      ],
    });
    const ctx = { view, stepsUsed: 0 };
    assert.equal(detectWalkerMode(ctx).name, "nav");
    const d = decideUnleash(ctx);
    assert.equal(d.mode, "nav");
    assert.match(d.line, /^open /);
  });

  it("never puts link_*, hop, or cancel in a form burst except the 20% finish dismiss", () => {
    const view = viewOf({
      page: "customers",
      surface: "add_customer",
      stack: ["page", "add_customer"],
      shown: [{ id: "name", value: "", type: "text" }],
      actions: [
        { id: "link_customers", role: "link", opens: "customers" },
        { id: "button_cancel", label: "Cancel" },
        { id: "create", label: "Create" },
        { id: "button_stay" },
      ],
      pages: ["home", "customers"],
    });
    const ctx: BrainContext = { view, stepsUsed: 0, writePolicy: "allow" };
    assert.equal(detectWalkerMode(ctx).name, "form");

    const submitText = burstText(ctx, () => 0.5);
    assert.match(submitText, /fill add_customer\.name /);
    assert.match(submitText, /click add_customer\.create/);
    assert.doesNotMatch(submitText, /link_|open |button_cancel|button_stay/);

    const dismissText = burstText(ctx, () => 0);
    assert.match(dismissText, /fill add_customer\.name /);
    assert.match(dismissText, /click add_customer\.button_cancel/);
    assert.doesNotMatch(dismissText, /link_|open |create|button_stay/);
  });

  it("detects list on a filter bar with comboboxes, sort, and pager", () => {
    const view = viewOf({
      page: "payloads",
      pages: ["home", "payloads", "payload_row_1"],
      shown: [{ id: "schema_key", value: "x", type: "text" }],
      actions: [
        { id: "combobox_status", role: "combobox", label: "Status" },
        { id: "combobox_readiness", role: "combobox", label: "Readiness" },
        { id: "button_sorted_descending__switch_to_ascending", label: "Sorted descending, switch to ascending" },
        { id: "button_next", label: "Next" },
        { id: "link_overview", role: "link", nav: true, opens: "home" },
        { id: "link_row_1", role: "link", opens: "payload_row_1" },
      ],
    });
    const ctx = { view, stepsUsed: 0 };
    assert.equal(detectWalkerMode(ctx).name, "list");
    const d = decideUnleash(ctx, () => 0);
    assert.equal(d.mode, "list");
    assert.match(d.line, /^click page\.combobox_/);
  });

  it("detects list on a filter plus Previous/Next without treating Next as submit", () => {
    const view = viewOf({
      page: "runs",
      pages: ["home", "runs"],
      shown: [],
      actions: [
        { id: "combobox_status", role: "combobox" },
        { id: "button_previous", label: "Previous" },
        { id: "button_next", label: "Next" },
      ],
    });
    assert.equal(detectWalkerMode({ view, stepsUsed: 0 }).name, "list");
    assert.doesNotMatch(decideUnleash({ view, stepsUsed: 0 }, () => 0).line, /button_next/);
  });

  it("keeps a wizard with dropdowns and Next in wizard mode", () => {
    const view = viewOf({
      shown: [{ id: "name", value: "", type: "text" }],
      actions: [
        { id: "combobox_country", role: "combobox" },
        { id: "combobox_state", role: "combobox" },
        { id: "button_next", label: "Next" },
      ],
    });
    const ctx: BrainContext = { view, stepsUsed: 0, writePolicy: "allow" };
    assert.equal(detectWalkerMode(ctx).name, "wizard");
    assert.match(burstText(ctx, () => 0.5), /click page\.button_next/);
  });

  it("keeps two settings comboboxes as nav", () => {
    const view = viewOf({
      actions: [
        { id: "combobox_theme", role: "combobox" },
        { id: "combobox_language", role: "combobox" },
      ],
    });
    assert.equal(detectWalkerMode({ view, stepsUsed: 0 }).name, "nav");
  });

  it("keeps a single combobox as nav", () => {
    const view = viewOf({
      actions: [
        { id: "combobox_status", role: "combobox" },
        { id: "button_expand" },
      ],
    });
    assert.equal(detectWalkerMode({ view, stepsUsed: 0 }).name, "nav");
  });

  it("detects wizard on fields + Next and stays on Next instead of hopping", () => {
    const view = viewOf({
      shown: [
        { id: "name", value: "", type: "text" },
        { id: "email", value: "", type: "email" },
      ],
      actions: [
        { id: "button_back", label: "Back" },
        { id: "button_next", label: "Next" },
      ],
      pages: ["home", "checkout"],
    });
    const ctx: BrainContext = { view, stepsUsed: 0, writePolicy: "allow" };
    assert.equal(detectWalkerMode(ctx).name, "wizard");
    const d = decideUnleash(ctx, () => 0.5);
    assert.equal(d.mode, "wizard");
    const text = (d.lines ?? [d.line]).join("\n");
    assert.match(text, /fill page\.name /);
    assert.match(text, /click page\.button_next/);
    assert.doesNotMatch(text, /open /);
  });

  it("keeps wizard Next after the same advance id was just clicked", () => {
    const view = viewOf({
      shown: [{ id: "name", value: "Ada", type: "text" }],
      actions: [{ id: "button_next", label: "Next" }],
    });
    const ctx: BrainContext = {
      view,
      stepsUsed: 2,
      writePolicy: "allow",
      recentClicks: ["button_next"],
    };
    assert.equal(detectWalkerMode(ctx).name, "wizard");
    const d = decideUnleash(ctx, () => 0.5);
    assert.equal(d.mode, "wizard");
    assert.match(d.line, /click page\.button_next/);
  });

  it("fills a wizard under validationOnly and does not click Next", () => {
    const view = viewOf({
      shown: [{ id: "name", value: "", type: "text" }],
      actions: [{ id: "button_next", label: "Next" }],
    });
    const ctx: BrainContext = { view, stepsUsed: 0, writePolicy: "validationOnly" };
    assert.equal(detectWalkerMode(ctx).name, "wizard");
    const text = burstText(ctx, () => 0.5);
    assert.match(text, /^fill page\.name /);
    assert.doesNotMatch(text, /click /);
  });

  it("treats wizard notes as form work so hunt does not immediately re-target", () => {
    assert.equal(isFormWorkNote("wizard"), true);
    assert.equal(isFormWorkNote("wizard dismiss"), true);
    assert.equal(isFormCommitNote("wizard"), true);
    assert.equal(isFormCommitNote("wizard dismiss"), false);
    assert.equal(isFormWorkNote("form hunt"), false);
  });

  it("stamps only when the note is that mode's own work", () => {
    assert.equal(shouldStampMode({ line: "click page.tab_a", mode: "tab", note: "tab" }), true);
    assert.equal(shouldStampMode({ line: "click page.open_share", mode: "dialog", note: "dialog" }), true);
    assert.equal(shouldStampMode({ line: "click page.create_your_first", mode: "empty", note: "empty" }), true);
    assert.equal(shouldStampMode({ line: "click page.chrome", mode: "tab" }), false);
    assert.equal(shouldStampMode({ line: "open invoices", mode: "list", note: "form hunt" }), false);
    assert.equal(shouldStampMode({ line: "open home", mode: "nav", note: "hop" }), false);
  });

  it("matches paladin lines to mode work, not hops", () => {
    const view = viewOf({
      actions: [
        { id: "tab_billing", role: "tab", label: "Billing" },
        { id: "link_home", opens: "home" },
      ],
    });
    assert.equal(lineMatchesMode("click page.tab_billing", "tab", view), true);
    assert.equal(lineMatchesMode("open home", "tab", view), false);
    assert.equal(lineMatchesMode("screenshot", "form", view), false);
  });

  it("does not treat list Previous+Next with filters as wizard", () => {
    const view = viewOf({
      shown: [{ id: "search", value: "", type: "text" }],
      actions: [
        { id: "combobox_status", role: "combobox" },
        { id: "button_previous", label: "Previous" },
        { id: "button_next", label: "Next" },
      ],
    });
    assert.equal(detectWalkerMode({ view, stepsUsed: 0 }).name, "list");
  });

  it("keeps form when fields, filters, and a real submit share a surface", () => {
    const view = viewOf({
      shown: [{ id: "name", value: "", type: "text" }],
      actions: [
        { id: "combobox_status", role: "combobox" },
        { id: "combobox_readiness", role: "combobox" },
        { id: "submit" },
      ],
    });
    const ctx: BrainContext = { view, stepsUsed: 0, writePolicy: "allow" };
    assert.equal(detectWalkerMode(ctx).name, "form");
    const text = burstText(ctx, () => 0.5);
    assert.match(text, /click page\.submit/);
  });

  it("picks the staler of form and list when both apply and fields are filled", () => {
    const view = viewOf({
      shown: [
        { id: "name", value: "Ada", type: "text" },
        { id: "search", value: "", type: "text" },
      ],
      actions: [
        { id: "combobox_status", role: "combobox" },
        { id: "submit" },
      ],
    });
    const ctx: BrainContext = { view, stepsUsed: 0, writePolicy: "allow" };
    assert.equal(detectWalkerMode(ctx).name, "form");
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    assert.equal(detectWalkerMode({ ...ctx, modeFog: { "home/form": hourAgo } }).name, "form");
    assert.equal(
      detectWalkerMode({ ...ctx, modeFog: { "home/form": hourAgo }, recentClicks: ["submit"] }).name,
      "list",
    );
    assert.equal(detectWalkerMode({ ...ctx, modeFog: { "home/list": hourAgo } }).name, "form");
  });

  it("stays in form while empty fields remain even when list chrome is hungrier", () => {
    const view = viewOf({
      shown: [
        { id: "name", value: "", type: "text" },
        { id: "amount", value: "", type: "text" },
        { id: "search", value: "", type: "text" },
      ],
      actions: [
        { id: "combobox_status", role: "combobox" },
        { id: "button_previous", label: "Previous" },
        { id: "button_next", label: "Next" },
        { id: "tab_dashboard", role: "tab", label: "Dashboard" },
        { id: "tab_active", role: "tab", label: "Active" },
        { id: "button_save", label: "Save" },
      ],
    });
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const ctx: BrainContext = {
      view,
      stepsUsed: 0,
      writePolicy: "allow",
      modeFog: { "home/form": hourAgo },
    };
    assert.equal(detectWalkerMode(ctx).name, "form");
    const text = burstText(ctx, () => 0.5);
    assert.match(text, /click page\.button_save/);
  });

  it("treats a create form with many empty fields as form even without an enabled Save", () => {
    const view = viewOf({
      shown: [
        { id: "legalname", value: "", type: "text" },
        { id: "dbaname", value: "", type: "text" },
        { id: "website", value: "", type: "text" },
        { id: "notes", value: "", type: "text" },
      ],
      actions: [{ id: "tab_dashboard", role: "tab", label: "Dashboard" }],
    });
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const ctx: BrainContext = {
      view,
      stepsUsed: 0,
      writePolicy: "allow",
      modeFog: { "home/form": hourAgo },
    };
    assert.equal(detectWalkerMode(ctx).name, "form");
    const text = burstText(ctx, () => 0.5);
    assert.match(text, /^fill page\./);
    assert.doesNotMatch(text, /click page\.(button_next|tab_dashboard)/);
  });

  it("fills every empty field on a form with no Save, but skips extra child rows", () => {
    const view = viewOf({
      shown: [
        ...Array.from({ length: 13 }, (_, i) => ({ id: `f${i}`, value: "", type: "text" as const })),
        { id: "lineitems_0__amount", value: "", type: "text" as const },
        { id: "lineitems_1__amount", value: "", type: "text" as const },
      ],
      actions: [{ id: "tab_dashboard", role: "tab", label: "Dashboard" }],
    });
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const ctx: BrainContext = {
      view,
      stepsUsed: 0,
      writePolicy: "allow",
      modeFog: { "home/form": hourAgo },
    };
    assert.equal(detectWalkerMode(ctx).name, "form");
    const text = burstText(ctx, () => 0.5);
    const fills = text.split("\n").filter((l) => l.startsWith("fill "));
    assert.equal(fills.length, 14);
    assert.match(text, /fill page\.f12 /);
    assert.match(text, /fill page\.lineitems_0__amount /);
    assert.doesNotMatch(text, /lineitems_1__/);
    assert.doesNotMatch(text, /click page\.tab_dashboard/);
  });

  it("stays in form and clicks Save when leftover listed rows remain after fields are filled", () => {
    const view = viewOf({
      shown: [{ id: "reference", value: "INV-1", type: "text" }],
      actions: [
        { id: "option_acme", role: "option", label: "Acme" },
        { id: "button_save", label: "Save" },
        { id: "tab_dashboard", role: "tab", label: "Dashboard", nav: true },
      ],
    });
    const ctx: BrainContext = {
      view,
      stepsUsed: 4,
      writePolicy: "allow",
      formHits: { "home/page": 3 },
    };
    assert.equal(detectWalkerMode(ctx).name, "form");
    const text = burstText(ctx, () => 0.5);
    assert.equal(text, "click page.button_save");
    assert.doesNotMatch(text, /tab_dashboard|option_acme/);
  });

  it("does not hunt or open another page while some body fields are filled and some are empty", () => {
    const view = viewOf({
      page: "invoices_new",
      pages: ["home", "invoices_new", "settings"],
      shown: [
        { id: "vendor", value: "Acme", type: "text" },
        { id: "gl", value: "6000", type: "text" },
        { id: "office", value: "Oslo", type: "text" },
        { id: "row_0_account", value: "", type: "text" },
      ],
      actions: [
        { id: "button_save", label: "Save" },
        { id: "tab_dashboard", role: "tab", label: "Dashboard" },
        { id: "link_settings", nav: true, opens: "settings" },
      ],
    });
    const pages: Page[] = [
      {
        id: "invoices_new",
        path: "/invoices/new",
        params: [],
        ready: { by: "testId", value: "invoices_new" },
        surfaces: [
          {
            id: "page",
            kind: "page",
            fields: [
              { id: "vendor", required: false, type: "text", by: "name", value: "vendor", status: "ok" },
              { id: "row_0_account", required: false, type: "text", by: "name", value: "account", status: "ok" },
            ],
            actions: [],
          },
        ],
      },
      {
        id: "settings",
        path: "/settings",
        params: [],
        ready: { by: "testId", value: "settings" },
        surfaces: [
          {
            id: "page",
            kind: "page",
            fields: [{ id: "name", required: false, type: "text", by: "name", value: "name", status: "ok" }],
            actions: [{ id: "submit", by: "testId", value: "submit", status: "ok" }],
          },
        ],
      },
    ];
    const ctx: BrainContext = {
      view,
      stepsUsed: 3,
      writePolicy: "allow",
      pages,
    };
    assert.equal(detectWalkerMode(ctx).name, "form");
    const text = burstText(ctx, () => 0.5);
    assert.match(text, /fill page\.row_0_account /);
    assert.match(text, /click page\.button_save/);
    assert.doesNotMatch(text, /^open /);
    assert.doesNotMatch(text, /tab_dashboard|link_settings/);
  });

  it("stays in form after some fields are filled even without Save, and does not hop tabs", () => {
    const view = viewOf({
      shown: [
        { id: "legalname", value: "Todd Turner", type: "text" },
        { id: "dbaname", value: "solutio omnis", type: "text" },
        { id: "website", value: "https://example.com", type: "text" },
        { id: "industry", value: "", type: "text" },
      ],
      actions: [
        { id: "tab_dashboard", role: "tab", label: "Dashboard" },
        { id: "button_active_tabs__6", label: "Active tabs" },
      ],
    });
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const ctx: BrainContext = {
      view,
      stepsUsed: 3,
      writePolicy: "allow",
      modeFog: { "home/form": hourAgo },
      formHits: { "home/page": 1 },
    };
    assert.equal(detectWalkerMode(ctx).name, "form");
    const text = burstText(ctx, () => 0.5);
    assert.match(text, /fill page\.industry /);
    assert.doesNotMatch(text, /click page\.(tab_dashboard|button_active_tabs)/);
  });

  it("stays in form to click mapped Save after every field is filled", () => {
    const view = viewOf({
      shown: [
        { id: "legalname", value: "Todd Turner", type: "text" },
        { id: "notes", value: "hello", type: "text" },
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
    ];
    const ctx: BrainContext = {
      view,
      stepsUsed: 4,
      writePolicy: "allow",
      pages: pages as BrainContext["pages"],
      formHits: { "home/page": 1 },
    };
    assert.equal(detectWalkerMode(ctx).name, "form");
    const text = burstText(ctx, () => 0.5);
    assert.match(text, /click page\.button_save/);
    assert.doesNotMatch(text, /tab_dashboard/);
  });

  it("leaves a form after Save failed and nothing remains to fill", () => {
    const view = viewOf({
      page: "documents_ocg_id1",
      pages: ["documents_ocg_id1", "clients_new"],
      shown: [{ id: "sourcecitation", value: "already", type: "text" }],
      actions: [{ id: "ocg_upload_submit", label: "Submit" }],
      last: { step: "click page.ocg_upload_submit", ok: false, finding: "expectFailed" },
    });
    const clients: Page = {
      id: "clients_new",
      path: "/clients/new",
      params: [],
      ready: { by: "testId", value: "clients_new" },
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [
            {
              id: "name",
              required: true,
              type: "text",
              by: "name",
              value: "name",
              status: "ok",
            },
          ],
          actions: [{ id: "button_save", by: "testId", value: "save", status: "ok" }],
        },
      ],
    };
    const ocg: Page = {
      id: "documents_ocg_id1",
      path: "/documents/ocg/1",
      params: [],
      ready: { by: "testId", value: "ocg" },
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [],
          actions: [{ id: "ocg_upload_submit", by: "testId", value: "submit", status: "ok" }],
        },
      ],
    };
    const d = decideUnleash(
      {
        view,
        stepsUsed: 8,
        writePolicy: "allow",
        pages: [ocg, clients],
        last: { ok: false, finding: "expectFailed" },
        recentClicks: ["ocg_upload_submit"],
      },
      () => 0.9,
    );
    assert.notEqual(d.note, "form stay");
    assert.doesNotMatch(d.line, /^screenshot/);
  });

  it("does not refill a form this run already spent", () => {
    const invoices: Page = {
      id: "invoices",
      path: "/invoices",
      params: [],
      ready: { by: "testId", value: "invoices" },
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [
            {
              id: "amount",
              required: false,
              type: "text",
              by: "name",
              value: "amount",
              status: "ok",
            },
          ],
          actions: [
            { id: "submit", by: "testId", value: "submit", status: "ok" },
          ],
        },
      ],
    };
    const home: Page = {
      id: "home",
      path: "/",
      params: [],
      ready: { by: "testId", value: "home" },
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [],
          actions: [
            { id: "link_invoices", by: "testId", value: "invoices", status: "ok", opens: "invoices" },
            { id: "submit", by: "testId", value: "submit", status: "ok" },
          ],
        },
      ],
    };
    const view = viewOf({
      shown: [{ id: "matterid", value: "", type: "text" }],
      actions: [
        { id: "submit", label: "Save" },
        { id: "link_invoices", opens: "invoices" },
      ],
      pages: ["home", "invoices"],
    });
    const ctx: BrainContext = {
      view,
      stepsUsed: 8,
      writePolicy: "allow",
      pages: [home, invoices],
      formSpent: { "home/page": true },
    };
    const d = decideUnleash(ctx, () => 0.5);
    const text = (d.lines ?? [d.line]).join("\n");
    assert.doesNotMatch(text, /fill page\.matterid/);
    assert.match(text, /open invoices|click page\.link_invoices/);
  });

  it("does not lock form on empty list filters with Apply", () => {
    const view = viewOf({
      shown: [{ id: "status", value: "", type: "text" }],
      actions: [
        { id: "combobox_status", role: "combobox" },
        { id: "button_apply", label: "Apply" },
        { id: "button_previous", label: "Previous" },
        { id: "button_next", label: "Next" },
        { id: "sorted_ascending", label: "Sorted ascending" },
      ],
    });
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    assert.equal(
      detectWalkerMode({
        view,
        stepsUsed: 0,
        writePolicy: "allow",
        modeFog: { "home/form": hourAgo },
      }).name,
      "list",
    );
  });

  it("does not lock wizard on Continue shopping", () => {
    const view = viewOf({
      shown: [{ id: "name", value: "", type: "text" }],
      actions: [
        { id: "button_continue_shopping", label: "Continue shopping" },
        { id: "submit", label: "Save" },
      ],
    });
    const ctx: BrainContext = { view, stepsUsed: 0, writePolicy: "allow" };
    assert.equal(detectWalkerMode(ctx).name, "form");
    assert.match(burstText(ctx, () => 0.5), /click page\.submit/);
  });

  it("locks wizard even when its own stamp is recent", () => {
    const view = viewOf({
      shown: [{ id: "name", value: "", type: "text" }],
      actions: [{ id: "button_next", label: "Next" }],
    });
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    assert.equal(
      detectWalkerMode({
        view,
        stepsUsed: 0,
        writePolicy: "allow",
        modeFog: { "home/wizard": hourAgo },
      }).name,
      "wizard",
    );
  });

  it("detects tab and empty modes", () => {
    const tabs = viewOf({
      actions: [
        { id: "tab_overview", role: "tab", label: "Overview" },
        { id: "tab_billing", role: "tab", label: "Billing" },
      ],
    });
    assert.equal(detectWalkerMode({ view: tabs, stepsUsed: 0 }).name, "tab");
    const d = decideUnleash({ view: tabs, stepsUsed: 0 }, () => 0);
    assert.equal(d.mode, "tab");
    assert.match(d.line, /tab_/);

    const chromeOnly = viewOf({
      actions: [
        { id: "link_open_in_new_tab", label: "Open in new tab" },
        { id: "button_close_tab", label: "Close tab" },
        { id: "button_new_tab", label: "New tab" },
      ],
    });
    assert.notEqual(detectWalkerMode({ view: chromeOnly, stepsUsed: 0 }).name, "tab");
    assert.equal(isTabAction({ id: "tab_overview" }), true);
    assert.equal(isTabAction({ id: "tabs_settings" }), true);
    assert.equal(isTabAction({ id: "link_open_in_new_tab", label: "Open in new tab" }), false);
    assert.equal(isTabAction({ id: "button_close_tab", label: "Close tab" }), false);
    assert.equal(isTabAction({ id: "button_new_tab", label: "New tab" }), false);
    assert.equal(isTabAction({ id: "button_active_tabs__15", label: "Active tabs" }), false);
    assert.equal(isTabAction({ id: "active_tabs" }), false);

    const empty = viewOf({
      actions: [{ id: "button_create_your_first_fee_entry", label: "Create your first fee entry" }],
    });
    assert.equal(detectWalkerMode({ view: empty, stepsUsed: 0 }).name, "empty");
    assert.match(decideUnleash({ view: empty, stepsUsed: 0 }, () => 0).line, /create_your_first/);

    const populated = viewOf({
      shown: [
        {
          id: "checkbox_press_space_to_toggle_row_selection__unchecked_",
          value: "false",
          type: "checkbox",
          label: "Press Space to toggle row selection (unchecked)",
        },
      ],
      actions: [
        { id: "button_create_your_first_vendor", label: "Create your first vendor" },
        { id: "button_row_acme", label: "Acme" },
      ],
    });
    assert.equal(listLooksPopulated(populated), true);
    assert.equal(legalUnleashActions(populated).some(isEmptyStateAction), false);
    assert.notEqual(detectWalkerMode({ view: populated, stepsUsed: 0 }).name, "empty");
    assert.doesNotMatch(decideUnleash({ view: populated, stepsUsed: 0 }, () => 0).line, /create_your_first/);

    const siblingCreate = viewOf({
      actions: [
        { id: "button_create_your_first_vendor", label: "Create your first vendor" },
        { id: "button_new_vendor", label: "New vendor" },
      ],
    });
    assert.equal(listLooksPopulated(siblingCreate), true);
    assert.doesNotMatch(decideUnleash({ view: siblingCreate, stepsUsed: 0 }, () => 0).line, /create_your_first/);
  });

  it("hunts a mapped form instead of only clicking tabs", () => {
    const home: Page = {
      id: "home",
      path: "/",
      params: [],
      ready: { by: "testId", value: "home" },
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [],
          actions: [
            { id: "tab_dashboard", by: "role", value: "tab", name: "Dashboard", status: "ok" },
            { id: "tab_active", by: "role", value: "tab", name: "Active", status: "ok" },
          ],
        },
      ],
    };
    const invoices: Page = {
      id: "invoices",
      path: "/invoices",
      params: [],
      ready: { by: "testId", value: "invoices" },
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [{ id: "amount", required: false, type: "text", by: "name", value: "amount", status: "ok" }],
          actions: [{ id: "submit", by: "testId", value: "submit", status: "ok" }],
        },
      ],
    };
    const view = viewOf({
      pages: ["home", "invoices"],
      actions: [
        { id: "tab_dashboard", role: "tab", label: "Dashboard" },
        { id: "tab_active", role: "tab", label: "Active" },
      ],
    });
    const ctx: BrainContext = { view, stepsUsed: 0, job: "unleash", pages: [home, invoices] };
    assert.equal(detectWalkerMode(ctx).name, "tab");
    const d = decideUnleash(ctx, () => 0.5);
    assert.equal(d.note, "form hunt");
    assert.match(d.line ?? "", /invoices/);
    assert.doesNotMatch(d.line ?? "", /tab_/);
  });

  it("clicks a tab when form hunt has nowhere to go", () => {
    const view = viewOf({
      actions: [
        { id: "tab_overview", role: "tab", label: "Overview" },
        { id: "tab_billing", role: "tab", label: "Billing" },
      ],
    });
    const d = decideUnleash({ view, stepsUsed: 0, job: "unleash" }, () => 0.5);
    assert.equal(d.mode, "tab");
    assert.equal(d.note, "tab");
    assert.match(d.line, /tab_/);
  });

  it("does not loop open the same list page when a mapped form is elsewhere", () => {
    const records: Page = {
      id: "records",
      path: "/records",
      params: [],
      ready: { by: "testId", value: "records" },
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [],
          actions: [
            { id: "combobox_period", by: "role", value: "combobox", name: "Period", status: "ok" },
            { id: "button_previous", by: "testId", value: "previous", status: "ok" },
            { id: "button_next", by: "testId", value: "next", status: "ok" },
            { id: "tab_dashboard", by: "role", value: "tab", name: "Dashboard", status: "ok" },
            { id: "button_active_tabs", by: "role", value: "button", name: "Active tabs", status: "ok" },
          ],
        },
      ],
    };
    const invoices: Page = {
      id: "invoices",
      path: "/invoices",
      params: [],
      ready: { by: "testId", value: "invoices" },
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [{ id: "amount", required: false, type: "text", by: "name", value: "amount", status: "ok" }],
          actions: [{ id: "submit", by: "testId", value: "submit", status: "ok" }],
        },
      ],
    };
    const view = viewOf({
      page: "records",
      pages: ["home", "records", "invoices"],
      actions: [
        { id: "combobox_period", role: "combobox", label: "Period" },
        { id: "button_previous", label: "Previous" },
        { id: "button_next", label: "Next" },
        { id: "tab_dashboard", role: "tab", label: "Dashboard" },
        { id: "button_active_tabs", label: "Active tabs" },
      ],
    });
    const pages = [records, invoices];
    const justNow = new Date().toISOString();
    const tabHungrier: BrainContext = {
      view,
      stepsUsed: 4,
      job: "unleash",
      pages,
      modeFog: { "records/list": justNow },
    };
    assert.equal(detectWalkerMode(tabHungrier).name, "tab");
    const listCtx: BrainContext = { view, stepsUsed: 0, job: "unleash", pages };
    assert.equal(detectWalkerMode(listCtx).name, "list");

    for (const ctx of [tabHungrier, listCtx]) {
      const recent: string[] = [];
      const lines: string[] = [];
      const notes: string[] = [];
      for (let i = 0; i < 6; i++) {
        const d = decideUnleash({ ...ctx, stepsUsed: ctx.stepsUsed + i, recentClicks: recent }, () => 0.5);
        lines.push(d.line);
        notes.push(d.note ?? "");
        const id = d.line.match(/^click page\.(.+)$/)?.[1];
        if (id) recent.push(id);
      }
      assert.ok(
        notes.includes("form hunt"),
        `never hunted (${ctx === tabHungrier ? "tab" : "list"}): ${lines.join(" | ")}`,
      );
      assert.ok(
        lines.every((l) => l !== "open records"),
        `looped open records: ${lines.join(" | ")}`,
      );
      assert.ok(
        lines.some((l) => /invoices/.test(l)),
        `never walked toward invoices: ${lines.join(" | ")}`,
      );
    }
  });

  it("opens a mapped dialog and stands down once inside it", () => {
    const customers: Page = {
      id: "customers",
      path: "/customers",
      params: [],
      ready: { by: "testId", value: "customers" },
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [],
          actions: [{ id: "button_add_customer", by: "testId", value: "add", status: "ok", opens: "add_customer" }],
        },
        {
          id: "add_customer",
          kind: "dialog",
          fields: [{ id: "name", required: false, type: "text", by: "name", value: "name", status: "ok" }],
          actions: [{ id: "create", by: "testId", value: "create", status: "ok" }],
        },
      ],
    };
    const view = viewOf({
      page: "customers",
      pages: ["home", "customers"],
      actions: [{ id: "button_add_customer", opens: "add_customer" }],
    });
    const ctx: BrainContext = { view, stepsUsed: 0, pages: [customers] };
    assert.equal(detectWalkerMode(ctx).name, "dialog");
    const d = decideUnleash(ctx, () => 0);
    assert.equal(d.mode, "dialog");
    assert.equal(d.line, "click page.button_add_customer");

    const inside = viewOf({
      page: "customers",
      surface: "add_customer",
      stack: ["page", "add_customer"],
      shown: [{ id: "name", value: "", type: "text" }],
      actions: [{ id: "create" }, { id: "button_cancel" }],
      pages: ["home", "customers"],
    });
    assert.equal(detectWalkerMode({ view: inside, stepsUsed: 1, pages: [customers], writePolicy: "allow" }).name, "form");
  });

  it("prefers an unopened dialog over one already visited this run", () => {
    const page: Page = {
      id: "home",
      path: "/",
      params: [],
      ready: { by: "testId", value: "home" },
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [],
          actions: [
            { id: "open_filters", by: "testId", value: "filters", status: "ok", opens: "filters" },
            { id: "open_share", by: "testId", value: "share", status: "ok", opens: "share" },
          ],
        },
        { id: "filters", kind: "dialog", fields: [], actions: [] },
        { id: "share", kind: "dialog", fields: [], actions: [] },
      ],
    };
    const view = viewOf({
      actions: [
        { id: "open_filters", opens: "filters" },
        { id: "open_share", opens: "share" },
      ],
    });
    const d = decideUnleash(
      { view, stepsUsed: 2, pages: [page], pageVisits: { "home/filters": 1 } },
      () => 0,
    );
    assert.equal(d.mode, "dialog");
    assert.equal(d.line, "click page.open_share");
  });

  it("opens Edit, not Archive/Delete, then hunts another form instead of looping confirms", () => {
    const record: Page = {
      id: "customers_id1",
      path: "/customers/:id1",
      params: ["id1"],
      ready: { by: "testId", value: "customer" },
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [],
          actions: [
            { id: "button_edit", by: "testId", value: "edit", status: "ok", opens: "edit" },
            { id: "button_archive", by: "testId", value: "archive", status: "ok", opens: "archive_" },
            { id: "button_delete", by: "testId", value: "delete", status: "ok", opens: "delete_" },
            { id: "link_invoices", by: "testId", value: "invoices", status: "ok", opens: "invoices" },
          ],
        },
        {
          id: "edit",
          kind: "dialog",
          fields: [{ id: "name", required: false, type: "text", by: "name", value: "name", status: "ok" }],
          actions: [{ id: "button_save", by: "testId", value: "save", status: "ok" }],
        },
        {
          id: "archive_",
          kind: "dialog",
          fields: [],
          actions: [{ id: "button_confirm", by: "testId", value: "confirm", status: "ok" }],
        },
        {
          id: "delete_",
          kind: "dialog",
          fields: [],
          actions: [{ id: "button_confirm", by: "testId", value: "confirm", status: "ok" }],
        },
      ],
    };
    const invoices: Page = {
      id: "invoices",
      path: "/invoices",
      params: [],
      ready: { by: "testId", value: "invoices" },
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [{ id: "amount", required: false, type: "text", by: "name", value: "amount", status: "ok" }],
          actions: [{ id: "submit", by: "testId", value: "submit", status: "ok" }],
        },
      ],
    };
    const view = viewOf({
      page: "customers_id1",
      pages: ["customers_id1", "invoices"],
      actions: [
        { id: "button_edit", opens: "edit" },
        { id: "button_archive", opens: "archive_" },
        { id: "button_delete", opens: "delete_" },
        { id: "link_invoices", opens: "invoices" },
      ],
    });
    const pages = [record, invoices];
    const first = decideUnleash({ view, stepsUsed: 2, pages, job: "unleash", writePolicy: "allow" }, () => 0);
    assert.equal(first.mode, "dialog");
    assert.equal(first.line, "click page.button_edit");
    assert.doesNotMatch(first.line, /archive|delete/);

    const afterEdit = decideUnleash(
      {
        view,
        stepsUsed: 4,
        pages,
        job: "unleash",
        writePolicy: "allow",
        pageVisits: { "customers_id1/edit": 1 },
      },
      () => 0.5,
    );
    assert.doesNotMatch(afterEdit.line ?? "", /archive|delete/);
    assert.ok(
      afterEdit.note === "form hunt" || afterEdit.line === "click page.button_edit",
      afterEdit.line,
    );

    const onlyDestroy = viewOf({
      ...view,
      actions: [
        { id: "button_archive", opens: "archive_" },
        { id: "button_delete", opens: "delete_" },
        { id: "link_invoices", opens: "invoices" },
      ],
    });
    const unleashSkip = decideUnleash(
      { view: onlyDestroy, stepsUsed: 2, pages, job: "unleash", writePolicy: "allow" },
      () => 0.5,
    );
    assert.equal(unleashSkip.note, "form hunt");
    assert.match(unleashSkip.line ?? "", /invoices/);
    const nasty = decideUnleash(
      { view: onlyDestroy, stepsUsed: 2, pages, job: "nasty", writePolicy: "allow" },
      () => 0,
    );
    assert.equal(nasty.mode, "dialog");
    assert.equal(nasty.line, "click page.button_archive");
  });

  it("samples list chrome once then opens a row instead of flipping sort", () => {
    const view = viewOf({
      page: "payloads",
      pages: ["home", "payloads", "payload_row_1"],
      shown: [{ id: "schema_key", value: "x", type: "text" }],
      actions: [
        { id: "combobox_status", role: "combobox" },
        { id: "combobox_readiness", role: "combobox" },
        { id: "combobox_has_unresolved_refs", role: "combobox" },
        { id: "combobox_sort_by", role: "combobox" },
        { id: "button_sorted_descending__switch_to_ascending" },
        { id: "button_sorted_ascending__switch_to_descending" },
        { id: "button_previous", label: "Previous" },
        { id: "button_next", label: "Next" },
        { id: "link_overview", role: "link", nav: true, opens: "home" },
        { id: "link_row_1", role: "link", opens: "payload_row_1" },
      ],
    });
    const recent: string[] = [];
    const lines: string[] = [];
    const notes: string[] = [];
    for (let i = 0; i < 12; i++) {
      const d = decideUnleash({ view, stepsUsed: i, recentClicks: recent }, () => 0);
      assert.equal(d.mode, "list");
      const line = d.line;
      lines.push(line);
      notes.push(d.note ?? "");
      const id = line.match(/^click page\.(.+)$/)?.[1];
      if (id) recent.push(id);
    }
    const chrome = lines.filter((l) => /combobox_|sorted_|button_previous|button_next/.test(l));
    const rows = lines.filter((l) => l.includes("link_row_1"));
    const hops = lines.filter((l) => l.startsWith("open "));
    assert.ok(chrome.length <= 6, `chrome ${chrome.join(", ")}`);
    assert.equal(new Set(chrome.filter((l) => l.includes("sorted_"))).size, 1);
    assert.ok(rows.length >= 1, `lines ${lines.join(" | ")}`);
    assert.ok(hops.length >= 1, `never hopped: ${lines.join(" | ")}`);
    assert.ok(notes.includes("list chrome"));
    assert.ok(notes.includes("list row"));
  });

  it("opens an in-page row link that has no mapped opens after sampling chrome", () => {
    const view = viewOf({
      page: "payloads",
      pages: ["home", "payloads"],
      shown: [{ id: "schema_key", value: "x", type: "text" }],
      actions: [
        { id: "combobox_status", role: "combobox" },
        { id: "button_sorted_descending__switch_to_ascending" },
        { id: "link_row_1", role: "link" },
      ],
    });
    const recent: string[] = [];
    const lines: string[] = [];
    for (let i = 0; i < 6; i++) {
      const d = decideUnleash({ view, stepsUsed: i, recentClicks: recent }, () => 0);
      assert.equal(d.mode, "list");
      lines.push(d.line);
      const id = d.line.match(/^click page\.(.+)$/)?.[1];
      if (id) recent.push(id);
    }
    assert.ok(
      lines.some((l) => l.includes("link_row_1")),
      `never opened row: ${lines.join(" | ")}`,
    );
  });

  it("never emits a form-style submit burst in nav mode", () => {
    const view = viewOf({
      shown: [{ id: "q", value: "", type: "text" }],
      actions: [
        { id: "button_add_customer", label: "Add customer", opens: "add_customer" },
        { id: "button_filter" },
      ],
    });
    for (let i = 0; i < 20; i++) {
      const d = decideUnleash({ view, stepsUsed: i });
      assert.equal(d.mode, "nav");
      const text = (d.lines ?? [d.line]).join("\n");
      assert.doesNotMatch(text, /fill page\.q/);
      assert.doesNotMatch(text, /click page\.submit/);
      assert.doesNotMatch(text, /^open /);
    }
  });
});

describe("formatExploreVisit", () => {
  it("includes mode, formatted view text, ready, legalOpen, and shot", () => {
    const view = viewOf({
      mode: "form",
      pages: ["home", "about"],
      shown: [{ id: "name", value: "", type: "text" }],
      actions: [{ id: "submit" }],
    });
    const ready = { by: "testId" as const, value: "home" };
    const visit = formatExploreVisit({
      view,
      ready,
      legalOpen: ["home", "about"],
      shot: "shots/home.png",
      sight: "create dialog",
      writePolicy: "validationOnly",
      planLine: "fill the name",
    });
    assert.equal(visit.mode, "form");
    assert.match(visit.formatted, /^page: home$/m);
    assert.match(visit.formatted, /^mode: form$/m);
    assert.deepEqual(visit.ready, ready);
    assert.deepEqual(visit.legalOpen, ["home", "about"]);
    assert.equal(visit.shot, "shots/home.png");
    assert.equal(visit.sight, "create dialog");
    assert.equal(visit.writePolicy, "validationOnly");
    assert.equal(visit.planLine, "fill the name");
    assert.equal(visit.view.page, "home");
    assert.equal(visit.view.mode, "form");
  });

  it("detects mode when missing and defaults legalOpen from view.pages", () => {
    const form = formatExploreVisit({
      view: viewOf({
        pages: ["home", "invoices"],
        shown: [{ id: "name", value: "", type: "text" }],
        actions: [{ id: "submit" }],
      }),
    });
    assert.equal(form.mode, "form");
    assert.match(form.formatted, /^mode: form$/m);
    assert.deepEqual(form.legalOpen, ["home", "invoices"]);
    assert.equal(form.ready, undefined);
    assert.equal(form.shot, undefined);

    const nav = formatExploreVisit({
      view: viewOf({
        actions: [{ id: "button_expand" }],
      }),
    });
    assert.equal(nav.mode, "nav");
    assert.match(nav.formatted, /^mode: nav$/m);
    assert.deepEqual(nav.legalOpen, []);

    const list = formatExploreVisit({
      view: viewOf({
        actions: [
          { id: "combobox_status", role: "combobox" },
          { id: "button_sorted_descending__switch_to_ascending" },
        ],
      }),
    });
    assert.equal(list.mode, "list");
    assert.match(list.formatted, /^mode: list$/m);
  });
});
