import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  PageModel,
  parseLog,
  formatLog,
  formatStep,
  parseLine,
  Config,
  LeashFile,
  emptyConfig,
  assertNotLegacyConfig,
  LegacyConfigError,
  Locator,
  View,
  TestabilityReport,
} from "../src/schema/index.js";

function fixture(name: string): unknown {
  const path = fileURLToPath(new URL(`../fixtures/models/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

describe("PageModel schema", () => {
  it("accepts valid-home", () => {
    const model = PageModel.parse(fixture("valid-home.json"));
    assert.equal(model.pages.length, 1);
    assert.equal(model.pages[0]?.surfaces.length, 2);
    assert.equal(model.pages[0]?.ready.by, "testId");
  });

  it("rejects extra root field", () => {
    assert.throws(() => PageModel.parse(fixture("extra-property.json")));
  });

  it("rejects missing ready", () => {
    assert.throws(() => PageModel.parse(fixture("missing-ready.json")));
  });

  it("rejects sloppy Grok draft", () => {
    assert.throws(() => PageModel.parse(fixture("sloppy-grok-draft.json")));
  });

  it("rejects illegal by", () => {
    assert.throws(() => Locator.parse({ by: "xpath", value: "//div" }));
  });

  it("rejects name on a non-role locator", () => {
    assert.throws(() =>
      Locator.parse({ by: "testId", value: "home", name: "x" }),
    );
  });

  it("accepts an optional origin on a page", () => {
    const model = PageModel.parse({
      schemaVersion: 1,
      app: "x",
      pages: [
        {
          id: "u_login",
          path: "/u/login",
          origin: "https://idp.example.com",
          ready: { by: "name", value: "username" },
          surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
        },
      ],
    });
    assert.equal(model.pages[0]?.origin, "https://idp.example.com");
  });

  it("accepts entry on a page", () => {
    const model = PageModel.parse({
      schemaVersion: 1,
      app: "x",
      pages: [
        {
          id: "login",
          path: "/login",
          entry: true,
          ready: { by: "testId", value: "login" },
          surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
        },
      ],
    });
    assert.equal(model.pages[0]?.entry, true);
  });

  it("accepts an optional page description", () => {
    const model = PageModel.parse({
      schemaVersion: 1,
      app: "x",
      pages: [
        {
          id: "invoices",
          path: "/invoices",
          ready: { by: "testId", value: "invoices" },
          surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
          description: "Invoices — 8 actions",
          describedBy: "inspect",
          describeKey: "abc123abc123",
        },
      ],
    });
    assert.equal(model.pages[0]?.description, "Invoices — 8 actions");
    assert.equal(model.pages[0]?.describedBy, "inspect");
  });

  it("rejects a page without surfaces", () => {
    assert.throws(() =>
      PageModel.parse({
        schemaVersion: 1,
        app: "x",
        pages: [{ id: "home", path: "/", ready: { by: "testId", value: "home" } }],
      }),
    );
  });
});

describe("line DSL", () => {
  it("round-trips a replay log", () => {
    const src = `# bug: empty name is accepted on create
# found: 2026-08-14

open home
click page.openCreate
fill createDialog.name ""
click createDialog.submit
expect createDialog.name invalid
`;
    const log = parseLog(src);
    assert.equal(log.bug, "empty name is accepted on create");
    assert.equal(log.steps.length, 5);
    assert.equal(formatLog(log), src);
  });

  it("parses secret tokens without resolving them", () => {
    const step = parseLine("fill login.password $CLICKMONKEY_PASSWORD", 1);
    assert.ok(step && !("comment" in step));
    assert.equal(step.kind, "fill");
    if (step.kind === "fill") assert.equal(step.value, "$CLICKMONKEY_PASSWORD");
  });

  it("round-trips a nav-landmark click", () => {
    assert.deepEqual(parseLine("click page.collections nav", 1), {
      kind: "click",
      surface: "page",
      id: "collections",
      nav: true,
    });
    assert.equal(
      formatStep({ kind: "click", surface: "page", id: "collections", nav: true }),
      "click page.collections nav",
    );
    assert.equal(
      formatStep({ kind: "click", surface: "page", id: "go" }),
      "click page.go",
    );
  });

  it("formats empty fill as quotes", () => {
    assert.equal(
      formatStep({ kind: "fill", surface: "s", id: "name", value: "" }),
      'fill s.name ""',
    );
  });

  it("round-trips screenshot lines", () => {
    assert.deepEqual(parseLine("screenshot", 1), { kind: "screenshot" });
    assert.equal(formatStep({ kind: "screenshot" }), "screenshot");
    assert.equal(
      formatStep({ kind: "screenshot", ui: true, label: "overlap on price" }),
      'screenshot ui "overlap on price"',
    );
    const step = parseLine('screenshot ui "overlap on price"', 1);
    assert.ok(step && !("comment" in step));
    assert.equal(step.kind, "screenshot");
    if (step.kind === "screenshot") {
      assert.equal(step.ui, true);
      assert.equal(step.label, "overlap on price");
    }
  });
});

describe("TestabilityReport schema", () => {
  it("accepts a page mark and rejects extra keys", () => {
    const report = TestabilityReport.parse({
      schemaVersion: 1,
      pages: [
        {
          path: "/",
          foundAt: "2026-08-14T00:00:00.000Z",
          insufficient: true,
          issues: [{ code: "opaqueControl", severity: "block", tag: "button" }],
        },
      ],
    });
    assert.equal(report.pages[0]?.issues[0]?.code, "opaqueControl");
    assert.throws(() =>
      TestabilityReport.parse({
        schemaVersion: 1,
        pages: [],
        score: 12,
      }),
    );
  });
});

describe("View schema", () => {
  it("accepts labels and content and rejects extra keys", () => {
    const view = View.parse({
      page: "home",
      surface: "page",
      stack: ["page"],
      shown: [{ id: "qty", value: "1", type: "number", label: "Quantity" }],
      actions: [{ id: "add_to_cart", label: "Add to bag" }],
      content: '- heading "Shop" [level=1]',
    });
    assert.equal(view.shown[0]?.label, "Quantity");
    assert.equal(view.actions[0]?.label, "Add to bag");
    assert.equal(view.content, '- heading "Shop" [level=1]');
    const withPages = View.parse({
      page: "home",
      pages: ["home", "about_html"],
      surface: "page",
      stack: ["page"],
      shown: [],
      actions: [],
    });
    assert.deepEqual(withPages.pages, ["home", "about_html"]);
    const withLook = View.parse({
      page: "home",
      surface: "page",
      stack: ["page"],
      shown: [],
      actions: [{ id: "go" }],
      look: {
        fonts: [{ family: "Arial", size: "16px", weight: "400", count: 3 }],
        covered: [{ id: "go", by: "blocker" }],
      },
    });
    assert.equal(withLook.look?.fonts[0]?.family, "Arial");
    assert.equal(withLook.look?.covered[0]?.by, "blocker");
    assert.throws(() =>
      View.parse({
        page: "home",
        surface: "page",
        stack: ["page"],
        shown: [],
        actions: [],
        html: "<div>",
      }),
    );
  });
});

describe("config", () => {
  it("parses a leash + empty map", () => {
    const cfg = Config.parse({
      url: "http://127.0.0.1:4173/",
      intro: ["open login", "fill login.password $CLICKMONKEY_PASSWORD"],
      map: { schemaVersion: 1, app: "fixture", pages: [] },
    });
    assert.equal(cfg.writePolicy, "validationOnly");
    assert.equal(cfg.map.pages.length, 0);
  });

  it("accepts skip on a leash", () => {
    const cfg = Config.parse({
      url: "http://127.0.0.1:4173/",
      skip: ["sign out", "close panel"],
      map: { schemaVersion: 1, app: "x", pages: [] },
    });
    assert.deepEqual(cfg.skip, ["sign out", "close panel"]);
  });

  it("accepts a leash file with no map", () => {
    const leash = LeashFile.parse({
      url: "http://127.0.0.1:4173/",
      intro: [],
    });
    assert.equal(leash.map, undefined);
    assert.equal(leash.writePolicy, "validationOnly");
  });

  it("accepts optional brain and does not require it on emptyConfig", () => {
    const cfg = Config.parse({
      url: "http://127.0.0.1:4173/",
      map: { schemaVersion: 1, app: "fixture", pages: [] },
      brain: { baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.2" },
    });
    assert.equal(cfg.brain?.model, "llama3.2");
    assert.equal(emptyConfig("http://127.0.0.1:4173/").brain, undefined);
    assert.throws(() =>
      Config.parse({
        url: "http://127.0.0.1:4173/",
        map: { schemaVersion: 1, app: "fixture", pages: [] },
        brain: { baseUrl: "http://127.0.0.1:11434/v1", model: "x", extra: true },
      }),
    );
  });

  it("rejects 0.0.7 intro/proxy_port", () => {
    assert.throws(
      () => assertNotLegacyConfig({ url: "http://x", intro: () => {}, proxy_port: 9034 }),
      LegacyConfigError,
    );
  });
});
