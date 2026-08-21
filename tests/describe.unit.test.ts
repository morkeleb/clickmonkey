import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Page } from "../src/schema/page-model.js";
import {
  applyMissingPageDescriptions,
  applyPageDescription,
  applyVisionBlurb,
  visionMayDescribe,
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

  it("does not replace a vision blurb when widgets change", () => {
    const page = pageOf({ id: "home", path: "/" });
    applyPageDescription(page);
    applyVisionBlurb(page, "Home dashboard with KPI cards and a search field.");
    const blurb = page.description;
    page.surfaces[0]!.fields.push({
      id: "name",
      required: false,
      type: "text",
      by: "name",
      value: "name",
      status: "ok",
    });
    assert.equal(applyPageDescription(page), true);
    assert.equal(page.description, blurb);
    assert.equal(page.describedBy, "vision");
  });

  it("does not replace an explore (LLM) blurb when widgets change", () => {
    const page = pageOf({ id: "home", path: "/" });
    applyPageDescription(page);
    page.description = "Shop home with search and create.";
    page.describedBy = "explore";
    const blurb = page.description;
    page.surfaces[0]!.fields.push({
      id: "name",
      required: false,
      type: "text",
      by: "name",
      value: "name",
      status: "ok",
    });
    assert.equal(applyPageDescription(page), true);
    assert.equal(page.description, blurb);
    assert.equal(page.describedBy, "explore");
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

  it("does not overwrite a vision blurb", async () => {
    const page = pageOf({ id: "invoices", path: "/invoices" });
    applyVisionBlurb(page, "Invoice list with a create dialog.");
    const before = page.description;
    const ok = await polishPageDescription(page, async () => "Something else from the text brain.");
    assert.equal(ok, false);
    assert.equal(page.description, before);
    assert.equal(page.describedBy, "vision");
  });
});

describe("applyVisionBlurb", () => {
  it("replaces the mechanical line and stamps describedBy vision", () => {
    const page = pageOf({ id: "customers", path: "/customers" });
    applyPageDescription(page);
    assert.equal(
      applyVisionBlurb(page, "Customers list with KPI cards and an Add customer form."),
      true,
    );
    assert.equal(page.description, "Customers list with KPI cards and an Add customer form.");
    assert.equal(page.describedBy, "vision");
  });

  it("keeps the mechanical line on junk", () => {
    const page = pageOf({ id: "customers", path: "/customers" });
    applyPageDescription(page);
    const before = page.description;
    assert.equal(applyVisionBlurb(page, "click page.go"), false);
    assert.equal(page.description, before);
    assert.equal(page.describedBy, "inspect");
  });

  it("does not stamp a loading-frame caption as the page blurb", () => {
    const page = pageOf({ id: "ledger", path: "/finance/ledger" });
    applyPageDescription(page);
    const before = page.description;
    assert.equal(
      applyVisionBlurb(page, "Loading screen for Filevine Finance app; waits for content to appear."),
      false,
    );
    assert.equal(page.description, before);
    assert.equal(page.describedBy, "inspect");
  });

  it("replaces a loading-frame vision blurb with a real caption", () => {
    const page = pageOf({ id: "ledger", path: "/finance/ledger" });
    page.description = "Loading screen for Filevine Finance app; waits for content to appear.";
    page.describedBy = "vision";
    assert.equal(visionMayDescribe(page), true);
    assert.equal(
      applyVisionBlurb(page, "Ledger configuration with Active and Draft ledger cards."),
      true,
    );
    assert.equal(page.describedBy, "vision");
    assert.match(page.description ?? "", /Ledger configuration/);
  });

  it("does not replace a real vision blurb", () => {
    const page = pageOf({ id: "ledger", path: "/finance/ledger" });
    applyVisionBlurb(page, "Ledger configuration with Active and Draft ledger cards.");
    assert.equal(visionMayDescribe(page), false);
    assert.equal(applyVisionBlurb(page, "Something else entirely with KPI cards."), false);
    assert.match(page.description ?? "", /Ledger configuration/);
  });

  it("replaces an explore blurb", () => {
    const page = pageOf({ id: "customers", path: "/customers" });
    page.description = "Customers list from the text brain.";
    page.describedBy = "explore";
    assert.equal(
      applyVisionBlurb(page, "Customers dashboard with KPI cards and Add customer."),
      true,
    );
    assert.equal(page.describedBy, "vision");
    assert.match(page.description ?? "", /KPI/);
  });
});
