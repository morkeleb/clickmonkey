import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideUnleash } from "../src/brains/unleash.js";
import type { BrainContext } from "../src/brains/types.js";
import { detectWalkerMode, UNLEASH_MODES } from "../src/brains/walker-mode.js";
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
  it("lists form then list then nav", () => {
    assert.deepEqual(
      UNLEASH_MODES.map((m) => m.name),
      ["form", "list", "nav"],
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

  it("keeps a wizard with dropdowns and Next as form", () => {
    const view = viewOf({
      shown: [{ id: "name", value: "", type: "text" }],
      actions: [
        { id: "combobox_country", role: "combobox" },
        { id: "combobox_state", role: "combobox" },
        { id: "button_next", label: "Next" },
      ],
    });
    const ctx: BrainContext = { view, stepsUsed: 0, writePolicy: "allow" };
    assert.equal(detectWalkerMode(ctx).name, "form");
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
      assert.doesNotMatch(text, /click .*(submit|create|button_add_customer)/);
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
