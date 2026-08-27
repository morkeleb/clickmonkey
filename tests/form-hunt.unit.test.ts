import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decideFormHunt,
  floodHunt,
  formGoalKey,
  huntScore,
  isOnFormLock,
  mapFormGoals,
  parseFormLock,
} from "../src/brains/form-hunt.js";
import { FOG_OLD_MS } from "../src/brains/npc.js";
import { decideUnleash } from "../src/brains/unleash.js";
import type { Page } from "../src/schema/page-model.js";
import type { View } from "../src/schema/view.js";

function pageOf(opts: {
  id: string;
  path?: string;
  entry?: boolean;
  surfaces: Array<{
    id: string;
    kind: "page" | "dialog";
    fields?: Array<{ id: string; type?: "text" | "email" }>;
    actions?: Array<{ id: string; opens?: string }>;
  }>;
}): Page {
  return {
    id: opts.id,
    path: opts.path ?? `/${opts.id}`,
    ...(opts.entry ? { entry: true } : {}),
    params: [],
    ready: { by: "testId", value: opts.id },
    surfaces: opts.surfaces.map((s) => ({
      id: s.id,
      kind: s.kind,
      fields: (s.fields ?? []).map((f) => ({
        id: f.id,
        required: false,
        type: f.type ?? "text",
        by: "name" as const,
        value: f.id,
        status: "ok" as const,
      })),
      actions: (s.actions ?? []).map((a) => ({
        id: a.id,
        by: "testId" as const,
        value: a.id,
        status: "ok" as const,
        ...(a.opens ? { opens: a.opens } : {}),
      })),
    })),
  };
}

const home = pageOf({
  id: "home",
  path: "/",
  surfaces: [
    {
      id: "page",
      kind: "page",
      actions: [
        { id: "link_customers", opens: "customers" },
        { id: "link_invoices", opens: "invoices" },
      ],
    },
  ],
});

const customers = pageOf({
  id: "customers",
  surfaces: [
    {
      id: "page",
      kind: "page",
      fields: [{ id: "q", type: "text" }],
      actions: [
        { id: "button_add_customer", opens: "add_customer" },
        { id: "link_home", opens: "home" },
      ],
    },
    {
      id: "add_customer",
      kind: "dialog",
      fields: [{ id: "name" }, { id: "email", type: "email" }],
      actions: [{ id: "create" }, { id: "button_cancel" }],
    },
  ],
});

const invoices = pageOf({
  id: "invoices",
  surfaces: [
    {
      id: "page",
      kind: "page",
      fields: [{ id: "amount" }],
      actions: [{ id: "submit" }],
    },
  ],
});

const searchOnly = pageOf({
  id: "search",
  surfaces: [
    {
      id: "page",
      kind: "page",
      fields: [{ id: "q" }],
      actions: [{ id: "go" }],
    },
  ],
});

function viewOf(partial: Partial<View>): View {
  return {
    page: "home",
    surface: "page",
    stack: ["page"],
    shown: [],
    actions: [],
    pages: ["home", "customers", "invoices"],
    ...partial,
  };
}

describe("mapFormGoals", () => {
  it("finds page and dialog forms, skips search-only", () => {
    const goals = mapFormGoals([home, customers, invoices, searchOnly]);
    assert.deepEqual(
      goals.map(formGoalKey).sort(),
      ["customers/add_customer", "invoices/page"].sort(),
    );
  });
});

describe("floodHunt", () => {
  it("opens a hoppable page, then clicks the dialog opener", () => {
    const fromHome = floodHunt(
      { page: "home", surface: "page" },
      [home, customers, invoices],
      ["home", "customers", "invoices"],
      home.surfaces[0]!.actions.map((a) => ({ id: a.id, opens: a.opens })),
    );
    const add = fromHome.get("customers/add_customer");
    assert.ok(add);
    assert.equal(add.dist, 2);
    assert.deepEqual(add.first, { kind: "open", page: "customers" });

    const fromCustomers = floodHunt(
      { page: "customers", surface: "page" },
      [home, customers, invoices],
      ["home", "customers", "invoices"],
      customers.surfaces[0]!.actions.map((a) => ({ id: a.id, opens: a.opens })),
    );
    const click = fromCustomers.get("customers/add_customer");
    assert.equal(click?.dist, 1);
    assert.equal(click?.first?.kind, "click");
    if (click?.first?.kind === "click") assert.equal(click.first.id, "button_add_customer");
  });
});

describe("decideFormHunt", () => {
  it("hops toward an untested dialog form", () => {
    const d = decideFormHunt(
      {
        view: viewOf({
          actions: [
            { id: "link_customers", opens: "customers" },
            { id: "link_invoices", opens: "invoices" },
          ],
        }),
        stepsUsed: 0,
        pages: [home, customers, invoices],
      },
      () => 0,
    );
    assert.ok(d);
    assert.equal(d.note, "form hunt");
    assert.match(d.line, /^open (customers|invoices)$/);
    assert.ok(d.huntTarget);
  });

  it("clicks the opener when already on the host page", () => {
    const d = decideFormHunt(
      {
        view: viewOf({
          page: "customers",
          pages: ["home", "customers", "invoices"],
          shown: [{ id: "q", value: "", type: "text" }],
          actions: [{ id: "button_add_customer", opens: "add_customer" }],
        }),
        stepsUsed: 0,
        pages: [home, customers, invoices],
      },
      () => 0,
    );
    assert.equal(d?.line, "click page.button_add_customer");
    assert.equal(d?.huntTarget, "customers/add_customer");
  });

  it("stays put when already on a form surface", () => {
    const d = decideFormHunt(
      {
        view: viewOf({
          page: "invoices",
          shown: [{ id: "amount", value: "", type: "text" }],
          actions: [{ id: "submit" }],
        }),
        stepsUsed: 0,
        pages: [home, customers, invoices],
      },
      () => 0,
    );
    assert.equal(d, undefined);
  });

  it("prefers a never-landed form over a form landed an hour ago", () => {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const d = decideFormHunt(
      {
        view: viewOf({
          actions: [
            { id: "link_customers", opens: "customers" },
            { id: "link_invoices", opens: "invoices" },
          ],
        }),
        stepsUsed: 0,
        pages: [home, customers, invoices],
        pageFog: { invoices: hourAgo },
      },
      () => 0,
    );
    assert.equal(d?.huntTarget, "customers/add_customer");
    assert.equal(d?.line, "open customers");
  });

  it("deprioritises a form that was already filled", () => {
    const ctx = {
      view: viewOf({
        page: "customers",
        pages: ["home", "customers", "invoices"],
        actions: [
          { id: "button_add_customer", opens: "add_customer" },
          { id: "link_invoices", opens: "invoices" },
        ],
      }),
      stepsUsed: 4,
      pages: [home, customers, invoices],
      formHits: { "customers/add_customer": 3 },
    };
    const d = decideFormHunt(ctx, () => 0);
    assert.equal(d?.huntTarget, "invoices/page");
    assert.ok(d?.line === "open invoices" || d?.line === "click page.link_invoices");
  });

  it("skips a noop opener and hunts a different form", () => {
    const d = decideFormHunt(
      {
        view: viewOf({
          page: "customers",
          pages: ["home", "customers", "invoices"],
          actions: [
            { id: "button_add_customer", opens: "add_customer" },
            { id: "link_invoices", opens: "invoices" },
          ],
        }),
        stepsUsed: 2,
        pages: [home, customers, invoices],
        noopIds: ["button_add_customer"],
      },
      () => 0,
    );
    assert.equal(d?.huntTarget, "invoices/page");
    assert.ok(d?.line === "open invoices" || d?.line === "click page.link_invoices");
    assert.doesNotMatch(d?.line ?? "", /button_add_customer/);
  });

  it("keeps a committed target instead of flipping", () => {
    const d = decideFormHunt(
      {
        view: viewOf({
          actions: [
            { id: "link_customers", opens: "customers" },
            { id: "link_invoices", opens: "invoices" },
          ],
        }),
        stepsUsed: 2,
        pages: [home, customers, invoices],
        huntTarget: "invoices/page",
      },
      () => 0.5,
    );
    assert.equal(d?.huntTarget, "invoices/page");
    assert.equal(d?.line, "open invoices");
  });
});

describe("form lock", () => {
  it("parses --form page and page/surface", () => {
    assert.deepEqual(parseFormLock("clients_new"), { pageId: "clients_new", surfaceId: "page" });
    assert.deepEqual(parseFormLock("clients_new/page"), { pageId: "clients_new", surfaceId: "page" });
    assert.deepEqual(parseFormLock("settings/dialog"), { pageId: "settings", surfaceId: "dialog" });
  });

  it("hunts only the locked form page", () => {
    const d = decideFormHunt(
      {
        view: viewOf({
          actions: [
            { id: "link_customers", opens: "customers" },
            { id: "link_invoices", opens: "invoices" },
          ],
        }),
        stepsUsed: 0,
        pages: [home, customers, invoices],
        lockForm: "invoices",
      },
      () => 0,
    );
    assert.equal(d?.note, "form hunt");
    assert.match(d?.line ?? "", /invoices/);
    assert.doesNotMatch(d?.line ?? "", /customers/);
  });

  it("does not hunt once standing on the locked page", () => {
    const ctx = {
      view: viewOf({
        page: "invoices",
        shown: [{ id: "amount", value: "", type: "text" as const }],
        actions: [{ id: "submit" }],
      }),
      stepsUsed: 0,
      pages: [home, customers, invoices],
      lockForm: "invoices",
    };
    assert.equal(isOnFormLock(ctx), true);
    assert.equal(decideFormHunt(ctx, () => 0), undefined);
  });
});

describe("huntScore", () => {
  it("prefers an untested form over a nearby one already filled", () => {
    assert.ok(huntScore(0, 2, FOG_OLD_MS) > huntScore(3, 0, FOG_OLD_MS));
  });

  it("prefers the closer form when hunger is equal", () => {
    assert.ok(huntScore(0, 0, FOG_OLD_MS) > huntScore(0, 1, FOG_OLD_MS));
    assert.ok(huntScore(1, 1, FOG_OLD_MS) > huntScore(1, 4, FOG_OLD_MS));
  });
});

describe("decideFormHunt mid-form", () => {
  it("does not hunt off a create form that still has filled and empty body fields", () => {
    const drafts = pageOf({
      id: "drafts",
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [{ id: "vendor" }, { id: "notes" }],
          actions: [{ id: "button_expand" }],
        },
      ],
    });
    const ctx = {
      view: viewOf({
        page: "drafts",
        pages: ["home", "customers", "invoices", "drafts"],
        shown: [
          { id: "vendor", value: "Acme", type: "text" as const },
          { id: "notes", value: "", type: "text" as const },
        ],
        actions: [{ id: "button_save", label: "Save" }],
      }),
      stepsUsed: 3,
      pages: [home, customers, invoices, drafts],
      writePolicy: "allow" as const,
    };
    assert.equal(decideFormHunt(ctx, () => 0), undefined);
    const d = decideUnleash(ctx, () => 0.5);
    const text = (d.lines ?? [d.line]).join("\n");
    assert.notEqual(d.note, "form hunt");
    assert.match(text, /click page\.button_save/);
    assert.doesNotMatch(text, /^open /);
  });
});

describe("decideUnleash form hunt", () => {
  it("opens a mapped form page instead of grinding nav chrome", () => {
    const view = viewOf({
      actions: [
        { id: "link_home", nav: true, opens: "home" },
        { id: "button_expand" },
      ],
    });
    const d = decideUnleash(
      { view, stepsUsed: 0, pages: [home, customers, invoices] },
      () => 0.5,
    );
    assert.equal(d.note, "form hunt");
    assert.match(d.line, /^open (customers|invoices)$/);
  });

  it("stays on a new entity while lootSteps remain, even if hunt would fire", () => {
    const view = viewOf({
      page: "customer_123",
      pages: ["home", "customers", "invoices"],
      actions: [
        { id: "button_edit" },
        { id: "link_home", nav: true, opens: "home" },
      ],
    });
    const d = decideUnleash(
      { view, stepsUsed: 8, pages: [home, customers, invoices], lootSteps: 4 },
      () => 0.5,
    );
    assert.notEqual(d.note, "form hunt");
    assert.equal(d.line, "click page.button_edit");
  });

  it("still samples list chrome when rng stays local", () => {
    const view = viewOf({
      page: "payloads",
      pages: ["home", "payloads", "customers"],
      shown: [{ id: "schema_key", value: "x", type: "text" }],
      actions: [
        { id: "combobox_status", role: "combobox" },
        { id: "combobox_readiness", role: "combobox" },
        { id: "button_sorted_descending__switch_to_ascending" },
        { id: "button_next", label: "Next" },
        { id: "link_row_1", role: "link", opens: "payload_row_1" },
      ],
    });
    const d = decideUnleash({ view, stepsUsed: 0, pages: [home, customers] }, () => 0);
    assert.equal(d.mode, "list");
    assert.match(d.line, /^click page\.combobox_/);
  });
});
