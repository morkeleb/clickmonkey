import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Page } from "../src/schema/page-model.js";
import {
  applyMissingPageDescriptions,
  applyPageDescription,
  describeKeyOf,
  mechanicalDescription,
  polishPageDescription,
} from "../src/surveyor/describe.js";

function pageOf(partial: Partial<Page> & Pick<Page, "id" | "path">): Page {
  return {
    params: [],
    ready: { by: "testId", value: partial.id },
    surfaces: [
      {
        id: "page",
        kind: "page",
        fields: [{ id: "q", required: false, type: "text", by: "name", value: "q", status: "ok" }],
        actions: [{ id: "go", by: "testId", value: "go", status: "ok" }],
      },
    ],
    ...partial,
  };
}

describe("mechanicalDescription", () => {
  it("uses heading, fields, and dialogs — not a dump of actions", () => {
    const page = pageOf({
      id: "invoices",
      path: "/accounts-receivable/invoices",
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [
            { id: "search", required: false, type: "text", by: "name", value: "q", name: "Search", status: "ok" },
          ],
          actions: [
            { id: "new_invoice", by: "testId", value: "new", status: "ok" },
            { id: "export", by: "testId", value: "export", status: "ok" },
          ],
        },
        { id: "create", kind: "dialog", fields: [], actions: [] },
      ],
    });
    const line = mechanicalDescription(page, { heading: "Invoices" });
    assert.match(line, /Accounts Receivable \/ Invoices/);
    assert.match(line, /Search/);
    assert.match(line, /dialogs: Create/);
    assert.doesNotMatch(line, /2 actions/);
  });

  it("falls back to action count when there are no fields", () => {
    const page = pageOf({
      id: "home",
      path: "/",
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [],
          actions: [
            { id: "go", by: "testId", value: "go", status: "ok" },
            { id: "more", by: "testId", value: "more", status: "ok" },
          ],
        },
      ],
    });
    assert.match(mechanicalDescription(page), /2 actions/);
  });
});

describe("applyPageDescription", () => {
  it("writes once and skips when the widget set is unchanged", () => {
    const page = pageOf({ id: "home", path: "/" });
    assert.equal(applyPageDescription(page, { heading: "Home" }), true);
    assert.ok(page.description);
    assert.equal(page.describedBy, "inspect");
    assert.equal(page.describeKey, describeKeyOf(page));
    const first = page.description;
    assert.equal(applyPageDescription(page, { heading: "Home" }), false);
    assert.equal(page.description, first);
  });

  it("refreshes when a field is added", () => {
    const page = pageOf({ id: "home", path: "/" });
    applyPageDescription(page);
    const key = page.describeKey;
    page.surfaces[0]!.fields.push({
      id: "name",
      required: false,
      type: "text",
      by: "name",
      value: "name",
      status: "ok",
    });
    assert.equal(applyPageDescription(page), true);
    assert.notEqual(page.describeKey, key);
    assert.match(page.description ?? "", /Name/);
  });
});

describe("applyMissingPageDescriptions", () => {
  it("fills every page that lacks a blurb", () => {
    const home = pageOf({ id: "home", path: "/" });
    const invoices = pageOf({ id: "invoices", path: "/invoices" });
    applyPageDescription(home, { heading: "Home" });
    const first = home.description;
    assert.equal(applyMissingPageDescriptions([home, invoices]), true);
    assert.equal(home.description, first);
    assert.ok(invoices.description);
    assert.equal(invoices.describedBy, "inspect");
  });
});

describe("polishPageDescription", () => {
  it("replaces the mechanical line when the model returns a sentence", async () => {
    const page = pageOf({ id: "invoices", path: "/invoices" });
    applyPageDescription(page);
    const ok = await polishPageDescription(page, async () => "Invoice list and create flow.");
    assert.equal(ok, true);
    assert.equal(page.description, "Invoice list and create flow.");
    assert.equal(page.describedBy, "explore");
  });

  it("keeps the mechanical line on junk", async () => {
    const page = pageOf({ id: "invoices", path: "/invoices" });
    applyPageDescription(page);
    const before = page.description;
    const ok = await polishPageDescription(page, async () => 'click page.go');
    assert.equal(ok, false);
    assert.equal(page.description, before);
  });
});
