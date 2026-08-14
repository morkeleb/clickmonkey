import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { withRun } from "../src/executor/session.js";
import { buildView, clipContent, CONTENT_MAX, formatView, usefulLabel } from "../src/executor/view.js";
import { PageModel, View } from "../src/schema/index.js";
import { serveSite } from "./helpers/fixture-server.js";

const homeModel = PageModel.parse(
  JSON.parse(
    readFileSync(fileURLToPath(new URL("../fixtures/models/valid-home.json", import.meta.url)), "utf8"),
  ) as unknown,
);

const catalogModel = PageModel.parse({
  schemaVersion: 1,
  app: "catalog",
  generation: 0,
  pages: [
    {
      id: "home",
      path: "/",
      params: [],
      ready: { by: "testId", value: "home" },
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [
            {
              id: "qty",
              required: false,
              type: "number",
              by: "testId",
              value: "qty",
              status: "ok",
            },
          ],
          actions: [
            { id: "add_to_cart", by: "testId", value: "add-to-cart", status: "ok" },
            { id: "view_case", by: "testId", value: "view-case", status: "ok" },
          ],
        },
      ],
    },
  ],
});

describe("formatView", () => {
  it("prints labels and a content block", () => {
    const view = View.parse({
      page: "home",
      surface: "page",
      stack: ["page"],
      shown: [{ id: "qty", value: "1", type: "number", label: "Quantity" }],
      actions: [{ id: "add_to_cart", label: "Add to bag" }],
      content: '- heading "Shop" [level=1]\n- text: "$79.99"',
      testability: {
        insufficient: true,
        issues: [{ code: "opaqueControl", severity: "block", tag: "button" }],
      },
    });
    const text = formatView(view);
    assert.match(text, /qty: "1"  \[number\]  Quantity/);
    assert.match(text, /add_to_cart  Add to bag/);
    assert.match(text, /content:\n {2}- heading "Shop"/);
    assert.match(text, / {2}- text: "\$79\.99"/);
    assert.match(text, /testability: insufficient/);
    assert.match(text, /opaqueControl  button/);
  });
});

describe("usefulLabel / clipContent", () => {
  it("drops labels that only repeat the id", () => {
    assert.equal(usefulLabel("submit", "Submit"), undefined);
    assert.equal(usefulLabel("add_to_cart", "Add to cart"), undefined);
    assert.equal(usefulLabel("qty", "Quantity"), "Quantity");
  });

  it("clips on a line boundary", () => {
    const raw = `${"a".repeat(CONTENT_MAX - 10)}\nkeep-me\n${"b".repeat(50)}`;
    const clipped = clipContent(raw);
    assert.match(clipped, /keep-me\n…$/);
    assert.equal(clipped.includes("b"), false);
  });
});

describe("buildView", () => {
  it("shows ok fields on the current surface without HTML", async () => {
    const { baseUrl, close } = await serveSite("validates");
    try {
      await withRun({}, async ({ page }) => {
        await page.goto(baseUrl);
        await page.getByTestId("open-create").click();
        const view = await buildView({
          page,
          pageId: "home",
          surfaceStack: ["page", "createDialog"],
          model: homeModel,
        });
        assert.equal(view.page, "home");
        assert.equal(view.surface, "createDialog");
        assert.deepEqual(view.stack, ["page", "createDialog"]);
        const name = view.shown.find((f) => f.id === "name");
        assert.ok(name);
        assert.equal(name.value, "");
        assert.equal(name.required, true);
        assert.equal(name.type, "text");
        assert.ok(view.actions.some((a) => a.id === "submit"));
        assert.ok(view.content);
        assert.match(view.content, /dialog/i);
        assert.match(view.content, /Submit/);
        assert.equal(view.content.includes("Create"), true);
        const json = JSON.stringify(view);
        assert.equal(/<\/?[a-z][\s\S]*>/i.test(json), false);
        const text = formatView(view);
        assert.match(text, /surface: createDialog/);
        assert.match(text, /name: ""  \[required, text\]/);
        assert.match(text, /content:/);
        assert.equal(view.testability?.insufficient ?? false, false);
        assert.ok(view.testability?.issues.some((i) => i.code === "unlabeledField"));
      });
    } finally {
      await close();
    }
  });

  it("scopes content to the open dialog, including validation copy", async () => {
    const { baseUrl, close } = await serveSite("validates");
    try {
      await withRun({}, async ({ page }) => {
        await page.goto(baseUrl);
        await page.getByTestId("open-create").click();
        await page.getByTestId("submit").click();
        const view = await buildView({
          page,
          pageId: "home",
          surfaceStack: ["page", "createDialog"],
          model: homeModel,
        });
        assert.ok(view.content);
        assert.match(view.content, /Name is required/);
      });
    } finally {
      await close();
    }
  });

  it("captures product copy on a non-form page and labels that differ from ids", async () => {
    const { baseUrl, close } = await serveSite("catalog");
    try {
      await withRun({}, async ({ page }) => {
        await page.goto(baseUrl);
        const view = await buildView({
          page,
          pageId: "home",
          surfaceStack: ["page"],
          model: catalogModel,
        });
        const qty = view.shown.find((f) => f.id === "qty");
        assert.ok(qty);
        assert.equal(qty.value, "1");
        assert.equal(qty.label, "Quantity");
        const add = view.actions.find((a) => a.id === "add_to_cart");
        assert.ok(add);
        assert.equal(add.label, "Add to bag");
        const see = view.actions.find((a) => a.id === "view_case");
        assert.ok(see);
        assert.equal(see.label, "See details");
        assert.ok(view.content);
        assert.match(view.content, /Shop/);
        assert.match(view.content, /Acme Wireless Headphones/);
        assert.match(view.content, /\$79\.99/);
        assert.match(view.content, /Noise cancelling/);
        assert.match(view.content, /Travel Case/);
        assert.match(view.content, /Hard shell case/);
        assert.equal(view.content.includes("Site chrome"), false);
        assert.equal(view.content.includes("Copyright"), false);
        const text = formatView(view);
        assert.match(text, /qty: "1"  \[number\]  Quantity/);
        assert.match(text, /add_to_cart  Add to bag/);
        assert.match(text, /view_case  See details/);
      });
    } finally {
      await close();
    }
  });
});
