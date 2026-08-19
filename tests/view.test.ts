import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { withRun } from "../src/executor/session.js";
import {
  buildView,
  clipContent,
  CONTENT_MAX,
  formatView,
  includeWalkAction,
  usefulLabel,
} from "../src/executor/view.js";
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
      pages: ["home", "about_html"],
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
    assert.match(text, /pages: home, about_html/);
    assert.doesNotMatch(text, /^pages:$/m);
    assert.match(text, /qty: "1"  \[number\]  Quantity/);
    assert.match(text, /add_to_cart  Add to bag/);
    assert.match(text, /content:\n {2}- heading "Shop"/);
    assert.match(text, / {2}- text: "\$79\.99"/);
    assert.match(text, /testability: insufficient/);
    assert.match(text, /opaqueControl  button/);
  });

  it("marks actions inside a navigation landmark", () => {
    const view = View.parse({
      page: "home",
      surface: "page",
      stack: ["page"],
      shown: [],
      actions: [
        { id: "save" },
        { id: "projects", nav: true, label: "Projects" },
      ],
    });
    const text = formatView(view);
    assert.match(text, /^ {2}save$/m);
    assert.match(text, /projects  Projects  \[nav\]/);
  });

  it("prints page blurbs next to hop targets", () => {
    const view = View.parse({
      page: "home",
      pages: ["home", "invoices"],
      pageNotes: {
        home: "Home — search",
        invoices: "Invoices — 8 actions",
      },
      surface: "page",
      stack: ["page"],
      shown: [],
      actions: [],
    });
    const text = formatView(view);
    assert.match(text, /^page: home — Home — search$/m);
    assert.match(text, /^pages:$/m);
    assert.match(text, /^ {2}invoices — Invoices — 8 actions$/m);
  });

  it("prints look fonts and covered widgets", () => {
    const view = View.parse({
      page: "home",
      surface: "page",
      stack: ["page"],
      shown: [],
      actions: [{ id: "go" }, { id: "ok" }],
      look: {
        fonts: [
          { family: "Arial", size: "16px", weight: "400", count: 4 },
          { family: "Times New Roman", size: "20px", weight: "700", count: 1 },
        ],
        covered: [{ id: "go", by: "blocker" }],
      },
    });
    const text = formatView(view);
    assert.match(text, /look:/);
    assert.match(text, /fonts: Arial 16px\/400 \(4\), Times New Roman 20px\/700 \(1\)/);
    assert.match(text, /covered: go ← blocker/);
  });
});

describe("includeWalkAction", () => {
  it("drops nav chrome after intro", () => {
    assert.equal(includeWalkAction({ inNav: true, hasIntro: true, inIntro: false }), false);
  });

  it("keeps nav chrome during intro", () => {
    assert.equal(includeWalkAction({ inNav: true, hasIntro: true, inIntro: true }), true);
  });

  it("keeps nav chrome when there is no intro", () => {
    assert.equal(includeWalkAction({ inNav: true, hasIntro: false, inIntro: false }), true);
    assert.equal(includeWalkAction({ inNav: true }), true);
  });

  it("always keeps main-pane widgets", () => {
    assert.equal(includeWalkAction({ inNav: false, hasIntro: true, inIntro: false }), true);
  });

  it("keeps in-page nav and dialog launchers after intro", () => {
    assert.equal(includeWalkAction({ inNav: true, inMain: true, hasIntro: true, inIntro: false }), true);
    assert.equal(includeWalkAction({ inNav: true, opens: true, hasIntro: true, inIntro: false }), true);
    assert.equal(includeWalkAction({ inNav: true, inMain: false, opens: false, hasIntro: true, inIntro: false }), false);
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
        assert.deepEqual(view.pages, ["home"]);
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

  it("omits mapped actions that are hidden or disabled", async () => {
    const { baseUrl, close } = await serveSite("validates");
    try {
      await withRun({}, async ({ page }) => {
        await page.goto(baseUrl);
        await page.evaluate(() => {
          const hidden = document.createElement("button");
          hidden.setAttribute("data-testid", "ghost");
          hidden.style.display = "none";
          hidden.textContent = "Ghost";
          document.body.appendChild(hidden);
          const dead = document.createElement("button");
          dead.setAttribute("data-testid", "dead");
          dead.disabled = true;
          dead.textContent = "Dead";
          document.body.appendChild(dead);
        });
        const model = structuredClone(homeModel);
        const pageSurf = model.pages[0]?.surfaces.find((s) => s.kind === "page");
        pageSurf?.actions.push(
          { id: "ghost", by: "testId", value: "ghost", status: "ok" },
          { id: "dead", by: "testId", value: "dead", status: "ok" },
        );
        const view = await buildView({
          page,
          pageId: "home",
          surfaceStack: ["page"],
          model,
        });
        assert.equal(view.actions.some((a) => a.id === "ghost"), false);
        assert.equal(view.actions.some((a) => a.id === "dead"), false);
        assert.ok(view.actions.some((a) => a.id === "openCreate"));
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

  it("omits nav-landmark actions after intro and still lists pages", async () => {
    const model = PageModel.parse({
      schemaVersion: 1,
      app: "chrome",
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
                  id: "q",
                  required: false,
                  type: "text",
                  by: "testId",
                  value: "q",
                  status: "ok",
                },
                {
                  id: "nav_q",
                  required: false,
                  type: "text",
                  by: "testId",
                  value: "nav-q",
                  status: "ok",
                },
              ],
              actions: [
                { id: "projects", by: "testId", value: "projects", status: "ok" },
                { id: "filters", by: "testId", value: "filters", opens: "filtersDialog", status: "ok" },
                { id: "invoices_tab", by: "testId", value: "invoices-tab", status: "ok" },
                { id: "save", by: "testId", value: "save", status: "ok" },
              ],
            },
          ],
        },
        {
          id: "about",
          path: "/about",
          params: [],
          ready: { by: "testId", value: "about" },
          surfaces: [
            {
              id: "page",
              kind: "page",
              fields: [],
              actions: [{ id: "ok", by: "testId", value: "ok", status: "ok" }],
            },
          ],
        },
      ],
    });
    await withRun({}, async ({ page }) => {
      await page.setContent(`
        <nav>
          <input data-testid="nav-q" />
          <button data-testid="projects">Projects</button>
          <button data-testid="filters">Filters</button>
        </nav>
        <main data-testid="home">
          <nav>
            <button data-testid="invoices-tab">Invoices</button>
          </nav>
          <input data-testid="q" />
          <button data-testid="save">Save</button>
        </main>
      `);
      const base = { page, pageId: "home", surfaceStack: ["page"], model };
      const intro = ["click login.submit"];

      const after = await buildView({ ...base, intro, inIntro: false });
      assert.equal(after.actions.some((a) => a.id === "projects"), false);
      assert.equal(after.shown.some((f) => f.id === "nav_q"), false);
      const filters = after.actions.find((a) => a.id === "filters");
      assert.ok(filters);
      assert.equal(filters.opens, "filtersDialog");
      const tab = after.actions.find((a) => a.id === "invoices_tab");
      assert.ok(tab);
      assert.equal(tab.nav, true);
      const save = after.actions.find((a) => a.id === "save");
      assert.ok(save);
      assert.equal(save.nav, undefined);
      assert.ok(after.shown.some((f) => f.id === "q"));
      assert.deepEqual(after.pages, ["home", "about"]);

      const during = await buildView({ ...base, intro, inIntro: true });
      const projects = during.actions.find((a) => a.id === "projects");
      assert.ok(projects);
      assert.equal(projects.nav, true);
      assert.ok(during.shown.some((f) => f.id === "nav_q"));
      assert.ok(during.actions.some((a) => a.id === "save"));

      const none = await buildView(base);
      const projectsNone = none.actions.find((a) => a.id === "projects");
      assert.ok(projectsNone);
      assert.equal(projectsNone.nav, true);
    });
  });
});
