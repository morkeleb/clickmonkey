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

  it("formats empty fill as quotes", () => {
    assert.equal(
      formatStep({ kind: "fill", surface: "s", id: "name", value: "" }),
      'fill s.name ""',
    );
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

  it("rejects 0.0.7 intro/proxy_port", () => {
    assert.throws(
      () => assertNotLegacyConfig({ url: "http://x", intro: () => {}, proxy_port: 9034 }),
      LegacyConfigError,
    );
  });
});
