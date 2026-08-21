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
  resolveVision,
  requireVisionShots,
  assertNotLegacyConfig,
  LegacyConfigError,
  Locator,
  View,
  ExploreVisit,
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
    const vision = PageModel.parse({
      ...model,
      pages: [{ ...model.pages[0]!, describedBy: "vision", description: "Customers dashboard with KPI cards." }],
    });
    assert.equal(vision.pages[0]?.describedBy, "vision");
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

  it("keeps Playwright Call log out of the DSL tape", () => {
    const dirty = `# bug: locator.click: Timeout 2000ms exceeded.
Call log:
  - waiting for getByRole('link', { name: 'Customers' })
      - <html lang="en"> intercepts pointer events

# found: 2026-08-19T19:18:21.170Z

open customers
click page.link_pipelines
`;
    const log = parseLog(dirty);
    assert.match(log.bug ?? "", /Timeout 2000ms exceeded/);
    assert.match(log.bug ?? "", /intercepts pointer events/);
    assert.equal(log.found, "2026-08-19T19:18:21.170Z");
    assert.equal(log.steps.length, 2);
    const out = formatLog(log);
    assert.match(out, /^# bug: locator\.click: Timeout 2000ms exceeded\. \(pointer events intercepted\)$/m);
    assert.doesNotMatch(out, /^Call log:/m);
    assert.match(out, /^open customers$/m);
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

  it("quotes fill values that are not bare tokens", () => {
    assert.equal(
      formatStep({ kind: "fill", surface: "page", id: "name", value: "Ada Lovelace" }),
      'fill page.name "Ada Lovelace"',
    );
    assert.equal(
      formatStep({ kind: "fill", surface: "page", id: "phone", value: "(555) 010-1234" }),
      'fill page.phone "(555) 010-1234"',
    );
    assert.equal(
      formatStep({ kind: "fill", surface: "page", id: "email", value: "user@example.com" }),
      "fill page.email user@example.com",
    );
    assert.equal(
      formatStep({ kind: "fill", surface: "page", id: "user", value: "$CLICKMONKEY_USER" }),
      "fill page.user $CLICKMONKEY_USER",
    );
  });

  it("round-trips expect text/value/hidden lines", () => {
    const lines = [
      'expect text "Saved"',
      'expect foo.bar text "Hello world"',
      'expect foo.bar value ""',
      "expect createDialog hidden",
    ];
    for (const line of lines) {
      const step = parseLine(line, 1);
      assert.ok(step && !("comment" in step));
      assert.equal(formatStep(step), line);
      assert.deepEqual(parseLine(formatStep(step), 1), step);
    }
    assert.deepEqual(parseLine('expect text "Saved"', 1), { kind: "expectPageText", text: "Saved" });
    assert.deepEqual(parseLine('expect foo.bar text "Hello world"', 1), {
      kind: "expectText",
      surface: "foo",
      id: "bar",
      text: "Hello world",
    });
    const quoted = formatStep({ kind: "expectPageText", text: 'Say "hi"' });
    assert.equal(quoted, String.raw`expect text "Say \"hi\""`);
    assert.deepEqual(parseLine(quoted, 1), { kind: "expectPageText", text: 'Say "hi"' });
    assert.deepEqual(parseLine('expect foo.bar value ""', 1), {
      kind: "expectValue",
      surface: "foo",
      id: "bar",
      value: "",
    });
    assert.deepEqual(parseLine("expect createDialog hidden", 1), {
      kind: "expectHidden",
      surface: "createDialog",
    });
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
          issues: [{ code: "opaqueControl", severity: "block", tag: "button", where: 'button "Save"' }],
        },
      ],
    });
    assert.equal(report.pages[0]?.issues[0]?.code, "opaqueControl");
    assert.equal(report.pages[0]?.issues[0]?.where, 'button "Save"');
    const extras = TestabilityReport.parse({
      schemaVersion: 1,
      pages: [
        {
          path: "/",
          foundAt: "2026-08-14T00:00:00.000Z",
          insufficient: false,
          issues: [{ code: "opaqueControl", severity: "warn", tag: "button", futureField: true }],
        },
      ],
    });
    assert.equal(extras.pages[0]?.issues[0]?.code, "opaqueControl");
    assert.equal("futureField" in (extras.pages[0]?.issues[0] ?? {}), false);
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
    const withMode = View.parse({
      page: "home",
      surface: "page",
      stack: ["page"],
      shown: [],
      actions: [],
      mode: "nav",
    });
    assert.equal(withMode.mode, "nav");
    const withList = View.parse({
      page: "home",
      surface: "page",
      stack: ["page"],
      shown: [],
      actions: [],
      mode: "list",
    });
    assert.equal(withList.mode, "list");
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
    assert.throws(() =>
      View.parse({
        page: "home",
        surface: "page",
        stack: ["page"],
        shown: [],
        actions: [],
        mode: "walk",
      }),
    );
  });
});

describe("ExploreVisit schema", () => {
  it("wraps a view and rejects extra keys", () => {
    const view = View.parse({
      page: "home",
      surface: "page",
      stack: ["page"],
      shown: [],
      actions: [{ id: "go" }],
      mode: "nav",
    });
    const visit = ExploreVisit.parse({
      mode: "nav",
      formatted: "page: home\nmode: nav\n",
      legalOpen: ["home"],
      shot: "shots/home.png",
      view,
    });
    assert.equal(visit.mode, "nav");
    assert.equal(visit.shot, "shots/home.png");
    assert.deepEqual(visit.legalOpen, ["home"]);
    assert.equal(visit.ready, undefined);
    assert.throws(() =>
      ExploreVisit.parse({
        mode: "nav",
        formatted: "page: home\n",
        view,
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
    const allow = Config.parse({
      url: "http://127.0.0.1:4173/",
      writePolicy: "allow",
      map: { schemaVersion: 1, app: "x", pages: [] },
    });
    assert.equal(allow.writePolicy, "allow");
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
    assert.equal(emptyConfig("http://127.0.0.1:4173/").seo, undefined);
    const seo = Config.parse({
      url: "http://127.0.0.1:4173/",
      map: { schemaVersion: 1, app: "fixture", pages: [] },
      seo: { private: ["/app"] },
    });
    assert.deepEqual(seo.seo?.private, ["/app"]);
    assert.throws(() =>
      Config.parse({
        url: "http://127.0.0.1:4173/",
        map: { schemaVersion: 1, app: "fixture", pages: [] },
        brain: { baseUrl: "http://127.0.0.1:11434/v1", model: "x", extra: true },
      }),
    );
  });

  it("defaults screenshots on when omitted", () => {
    const cfg = Config.parse({
      url: "http://127.0.0.1:4173/",
      map: { schemaVersion: 1, app: "fixture", pages: [] },
    });
    assert.equal(cfg.screenshots, true);
    assert.equal(emptyConfig("http://127.0.0.1:4173/").screenshots, true);
    const off = Config.parse({
      url: "http://127.0.0.1:4173/",
      screenshots: false,
      map: { schemaVersion: 1, app: "fixture", pages: [] },
    });
    assert.equal(off.screenshots, false);
  });

  it("accepts optional vision and rejects extra keys", () => {
    const omitted = Config.parse({
      url: "http://127.0.0.1:4173/",
      map: { schemaVersion: 1, app: "fixture", pages: [] },
    });
    assert.equal(omitted.vision, undefined);
    assert.throws(() =>
      Config.parse({
        url: "http://127.0.0.1:4173/",
        map: { schemaVersion: 1, app: "fixture", pages: [] },
        vision: { model: "qwen2.5-vl", extra: true },
      }),
    );
    assert.throws(() =>
      Config.parse({
        url: "http://127.0.0.1:4173/",
        map: { schemaVersion: 1, app: "fixture", pages: [] },
        vision: { baseUrl: "http://127.0.0.1:11434/v1" },
      }),
    );
  });

  it("resolveVision inherits baseUrl/apiKeyEnv but never brain.model", () => {
    const inherited = Config.parse({
      url: "http://127.0.0.1:4173/",
      map: { schemaVersion: 1, app: "fixture", pages: [] },
      brain: { baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5" },
      vision: { model: "qwen2.5-vl" },
    });
    const resolved = resolveVision(inherited.vision, inherited.brain);
    assert.equal(resolved?.model, "qwen2.5-vl");
    assert.equal(resolved?.baseUrl, "http://127.0.0.1:11434/v1");
    const override = Config.parse({
      url: "http://127.0.0.1:4173/",
      map: { schemaVersion: 1, app: "fixture", pages: [] },
      brain: {
        baseUrl: "http://127.0.0.1:11434/v1",
        model: "qwen2.5",
        apiKeyEnv: "BRAIN_KEY",
      },
      vision: {
        baseUrl: "http://127.0.0.1:8080/v1",
        model: "qwen2.5-vl",
        apiKeyEnv: "VISION_KEY",
      },
    });
    const full = resolveVision(override.vision, override.brain);
    assert.equal(full?.baseUrl, "http://127.0.0.1:8080/v1");
    assert.equal(full?.model, "qwen2.5-vl");
    assert.equal(full?.apiKeyEnv, "VISION_KEY");
    const mixed = Config.parse({
      url: "http://127.0.0.1:4173/",
      map: { schemaVersion: 1, app: "fixture", pages: [] },
      brain: {
        baseUrl: "https://api.x.ai/v1",
        model: "grok-4",
        apiKeyEnv: "XAI_API_KEY",
      },
      vision: { baseUrl: "http://127.0.0.1:8080/v1", model: "qwen2.5-vl" },
    });
    const mixedResolved = resolveVision(mixed.vision, mixed.brain);
    assert.equal(mixedResolved?.baseUrl, "http://127.0.0.1:8080/v1");
    assert.equal(mixedResolved?.apiKeyEnv, undefined);
    const offKey = Config.parse({
      url: "http://127.0.0.1:4173/",
      map: { schemaVersion: 1, app: "fixture", pages: [] },
      brain: { baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5", apiKeyEnv: "BRAIN_KEY" },
      vision: { model: "qwen2.5-vl", apiKeyEnv: false },
    });
    assert.equal(resolveVision(offKey.vision, offKey.brain)?.apiKeyEnv, undefined);
  });

  it("requireVisionShots rejects screenshots false with vision", () => {
    const cfg = Config.parse({
      url: "http://127.0.0.1:4173/",
      screenshots: false,
      map: { schemaVersion: 1, app: "fixture", pages: [] },
      vision: { baseUrl: "http://127.0.0.1:8080/v1", model: "qwen2.5-vl" },
    });
    assert.throws(() => requireVisionShots(cfg), /vision needs per-step screenshots/);
  });

  it("rejects vision with both issues and assist false", () => {
    assert.throws(
      () =>
        Config.parse({
          url: "http://127.0.0.1:4173/",
          map: { schemaVersion: 1, app: "fixture", pages: [] },
          vision: { model: "qwen2.5-vl", issues: false, assist: false },
        }),
      /vision.issues and vision.assist cannot both be false/,
    );
  });

  it("accepts a vision-only leash", () => {
    const leash = LeashFile.parse({
      url: "http://127.0.0.1:4173/",
      vision: { baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5-vl" },
    });
    assert.equal(leash.brain, undefined);
    const resolved = resolveVision(leash.vision, leash.brain);
    assert.equal(resolved?.baseUrl, "http://127.0.0.1:11434/v1");
    assert.equal(resolved?.model, "qwen2.5-vl");
    assert.equal(resolved?.issues, true);
    assert.equal(resolved?.assist, true);
  });

  it("resolveVision is undefined without a vision block and throws without a baseUrl", () => {
    assert.equal(resolveVision(undefined), undefined);
    assert.throws(
      () => resolveVision({ model: "x" }, undefined),
      /vision.baseUrl is required \(set vision.baseUrl or brain.baseUrl\)/,
    );
  });

  it("rejects 0.0.7 intro/proxy_port", () => {
    assert.throws(
      () => assertNotLegacyConfig({ url: "http://x", intro: () => {}, proxy_port: 9034 }),
      LegacyConfigError,
    );
  });
});
