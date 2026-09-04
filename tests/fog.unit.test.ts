import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FOG_OLD_MS, npcHunger, staleMsForPage } from "../src/brains/npc.js";
import { loadConfig, saveConfig } from "../src/persist/config.js";
import {
  formatFogStatus,
  leftoverFogPath,
  loadMapPages,
  recordFog,
  recordFormWork,
  recordMode,
  resetFog,
  shouldStampFog,
  stampFog,
} from "../src/persist/fog.js";
import { mapPath } from "../src/persist/workspace.js";
import {
  formWorkTimes,
  brainStampsSpec,
  jobFogOf,
  jobFogTimes,
  jobOfBrain,
  mergeLaterClocks,
  mergePageFog,
  modeFogTimes,
  monkeyOfBrain,
  pageFogTimes,
} from "../src/schema/fog.js";
import { emptyConfig } from "../src/schema/config.js";
import { decideMapScout } from "../src/brains/map-scout.js";
import { emptyDraft, type Page } from "../src/schema/page-model.js";
import type { View } from "../src/schema/view.js";

function homePage(fog?: Page["fog"]): Page {
  return {
    id: "home",
    path: "/",
    params: [],
    ready: { by: "testId", value: "home" },
    surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
    ...(fog ? { fog } : {}),
  };
}

function seed(cfg: string, pages: Page[] = [homePage()]): void {
  saveConfig(cfg, {
    ...emptyConfig("http://127.0.0.1:4173/"),
    map: { schemaVersion: 1, app: "app", generation: 0, pages },
  });
}

function fogOf(pages: readonly Page[], id: string): Page["fog"] | undefined {
  return pages.find((p) => p.id === id)?.fog;
}

describe("page fog", () => {
  it("records last land per page and skips a repeat on the same stay", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-fog-"));
    const cfg = join(dir, "clickmonkey.json");
    seed(cfg, [
      homePage(),
      { ...homePage(), id: "invoices", path: "/invoices", ready: { by: "testId", value: "invoices" } },
    ]);
    const first = stampFog(cfg, "home", "2026-01-01T00:00:00.000Z");
    assert.equal(fogOf(first.pages, "home")?.at, "2026-01-01T00:00:00.000Z");
    stampFog(cfg, "invoices", "2026-06-01T00:00:00.000Z");
    const loaded = loadMapPages(cfg);
    assert.equal(fogOf(loaded, "home")?.at, "2026-01-01T00:00:00.000Z");
    assert.equal(fogOf(loaded, "invoices")?.at, "2026-06-01T00:00:00.000Z");
    assert.equal(loadConfig(cfg).map.pages.find((p) => p.id === "home")?.fog?.at, "2026-01-01T00:00:00.000Z");
    const state = {
      configPath: cfg,
      pageId: "home",
      lastFogPageId: undefined as string | undefined,
      brain: "unleash",
    };
    recordFog(state);
    assert.equal(state.lastFogPageId, "home");
    const after = fogOf(loadMapPages(cfg), "home")?.at;
    recordFog(state);
    assert.equal(fogOf(loadMapPages(cfg), "home")?.at, after);
    assert.ok(fogOf(loadMapPages(cfg), "home")?.jobs.unleash);
  });

  it("skips replay and ignores a leftover unreadable lands.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-fog-bad-"));
    const cfg = join(dir, "clickmonkey.json");
    seed(cfg);
    const path = leftoverFogPath(cfg);
    const state = { configPath: cfg, replay: true, pageId: "home" };
    recordFog(state);
    assert.equal(fogOf(loadMapPages(cfg), "home"), undefined);
    writeFileSync(path, "{not json\n", "utf8");
    stampFog(cfg, "home", "2026-01-01T00:00:00.000Z");
    assert.equal(existsSync(path), false);
    assert.equal(fogOf(loadMapPages(cfg), "home")?.at, "2026-01-01T00:00:00.000Z");
  });

  it("does not stamp fog on 404 or replay", () => {
    assert.equal(shouldStampFog({}, true), false);
    assert.equal(shouldStampFog({ replay: true }, false), false);
    assert.equal(shouldStampFog({ replay: false }, false), true);
  });

  it("absorbs leftover lands.json onto the sitemap and keeps separate job and mode clocks", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-fog-v1-"));
    const cfg = join(dir, "clickmonkey.json");
    seed(cfg);
    mkdirSync(join(dir, "clickmonkey"), { recursive: true });
    writeFileSync(
      leftoverFogPath(cfg),
      `${JSON.stringify({ schemaVersion: 1, pages: { home: "2026-01-01T00:00:00.000Z" } })}\n`,
      "utf8",
    );
    const migrated = loadMapPages(cfg);
    assert.equal(fogOf(migrated, "home")?.at, "2026-01-01T00:00:00.000Z");
    assert.deepEqual(pageFogTimes(migrated), { home: "2026-01-01T00:00:00.000Z" });
    assert.deepEqual(jobFogTimes(migrated, "unleash"), {});
    stampFog(cfg, "home", { at: "2026-03-01T00:00:00.000Z", job: "map" });
    assert.equal(existsSync(leftoverFogPath(cfg)), false);
    stampFog(cfg, "home", { at: "2026-04-01T00:00:00.000Z", job: "unleash" });
    recordMode({ configPath: cfg }, "home", "list");
    const next = loadMapPages(cfg);
    assert.equal(jobFogTimes(next, "map").home, "2026-03-01T00:00:00.000Z");
    assert.equal(jobFogTimes(next, "unleash").home, "2026-04-01T00:00:00.000Z");
    assert.deepEqual(jobFogOf(fogOf(next, "home")), {
      map: "2026-03-01T00:00:00.000Z",
      unleash: "2026-04-01T00:00:00.000Z",
    });
    assert.equal(jobFogOf(undefined), undefined);
    assert.ok(modeFogTimes(next)["home/list"]);
    assert.equal(jobOfBrain("unleash-nasty"), "nasty");
    assert.equal(jobOfBrain("map"), "map");
    assert.equal(jobOfBrain("explore"), undefined);
    assert.equal(jobOfBrain("spec"), undefined);
    assert.equal(jobOfBrain("test"), undefined);
    assert.equal(brainStampsSpec("spec"), true);
    assert.equal(brainStampsSpec("test"), true);
    assert.equal(brainStampsSpec("unleash"), false);
    assert.equal(monkeyOfBrain("unleash-nasty"), "nasty");
    assert.equal(monkeyOfBrain("explore"), "explore");
    assert.equal(monkeyOfBrain("mcp"), "mcp");
    assert.equal(monkeyOfBrain("spec"), "spec");
    assert.equal(monkeyOfBrain("test"), "test");
  });

  it("full reset drops fog on sitemap pages and deletes leftover lands.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-fog-reset-"));
    const cfg = join(dir, "clickmonkey.json");
    seed(cfg);
    stampFog(cfg, "home", { at: "2026-01-01T00:00:00.000Z", job: "map" });
    stampFog(cfg, "home", { at: "2026-02-01T00:00:00.000Z", job: "unleash" });
    recordMode({ configPath: cfg }, "home", "form");
    writeFileSync(leftoverFogPath(cfg), "{not json\n", "utf8");
    const wiped = resetFog(cfg);
    assert.equal(fogOf(wiped.pages, "home"), undefined);
    assert.equal(fogOf(loadMapPages(cfg), "home"), undefined);
    assert.equal(loadConfig(cfg).map.pages.find((p) => p.id === "home")?.fog, undefined);
    assert.equal(existsSync(leftoverFogPath(cfg)), false);
    assert.ok(existsSync(mapPath(cfg)));
  });

  it("records form work per job and surface without lifting land or the other job", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-fog-form-"));
    const cfg = join(dir, "clickmonkey.json");
    seed(cfg, [
      homePage(),
      { ...homePage(), id: "customers", path: "/customers", ready: { by: "testId", value: "customers" } },
    ]);
    stampFog(cfg, "customers", { at: "2026-04-01T00:00:00.000Z", job: "map" });
    stampFog(cfg, "customers", {
      at: "2026-06-01T00:00:00.000Z",
      job: "unleash",
      form: "add_customer",
    });
    const afterUnleash = loadMapPages(cfg);
    assert.equal(jobFogTimes(afterUnleash, "unleash").customers, undefined);
    assert.equal(formWorkTimes(afterUnleash, "unleash")["customers/add_customer"], "2026-06-01T00:00:00.000Z");
    assert.deepEqual(formWorkTimes(afterUnleash, "nasty"), {});
    recordFormWork({ configPath: cfg, brain: "unleash" }, "customers", "edit");
    stampFog(cfg, "customers", {
      at: "2026-07-01T00:00:00.000Z",
      job: "nasty",
      form: "add_customer",
    });
    const both = loadMapPages(cfg);
    assert.equal(formWorkTimes(both, "unleash")["customers/add_customer"], "2026-06-01T00:00:00.000Z");
    assert.ok(formWorkTimes(both, "unleash")["customers/edit"]);
    assert.equal(formWorkTimes(both, "nasty")["customers/add_customer"], "2026-07-01T00:00:00.000Z");
    const merged = mergePageFog(fogOf(both, "customers"), {
      at: "2026-04-01T00:00:00.000Z",
      jobs: {},
      modes: {},
      forms: { unleash: { add_customer: "2026-01-01T00:00:00.000Z" } },
    });
    assert.equal(merged?.forms?.unleash?.add_customer, formWorkTimes(both, "unleash")["customers/add_customer"]);
    resetFog(cfg, "unleash");
    const afterReset = loadMapPages(cfg);
    assert.deepEqual(formWorkTimes(afterReset, "unleash"), {});
    assert.ok(formWorkTimes(afterReset, "nasty")["customers/add_customer"]);
    assert.equal(jobFogTimes(afterReset, "map").customers, "2026-04-01T00:00:00.000Z");
  });

  it("job reset drops only that clock and leaves at / other jobs / modes", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-fog-job-"));
    const cfg = join(dir, "clickmonkey.json");
    seed(cfg);
    stampFog(cfg, "home", { at: "2026-04-01T00:00:00.000Z", job: "map" });
    stampFog(cfg, "home", { at: "2026-05-01T00:00:00.000Z", job: "unleash", mode: "list" });
    resetFog(cfg, "unleash");
    const next = fogOf(loadMapPages(cfg), "home");
    assert.equal(next?.at, "2026-05-01T00:00:00.000Z");
    assert.equal(next?.jobs.map, "2026-04-01T00:00:00.000Z");
    assert.equal(next?.jobs.unleash, undefined);
    assert.ok(next?.modes.list);
  });

  it("formats sitemap pages, including full fog", () => {
    const text = formatFogStatus(emptyDraft(), "/tmp/map.json");
    assert.equal(text, "/tmp/map.json  0 pages  (full fog)\n");
    const now = Date.parse("2026-08-24T12:00:00.000Z");
    const lined = formatFogStatus(
      {
        schemaVersion: 1,
        app: "app",
        generation: 0,
        pages: [
          homePage({
            at: "2026-08-24T11:00:00.000Z",
            jobs: { map: "2026-08-22T12:00:00.000Z" },
            modes: { form: "2026-08-24T11:30:00.000Z" },
          }),
        ],
      },
      "/tmp/map.json",
      now,
    );
    assert.match(lined, /1 page/);
    assert.match(lined, /home  at 1h  map 2d  unleash never  nasty never  spec never  form now/);
  });

  it("stamps a shared spec coverage pip for spec and typed tests, not hunt jobs", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-fog-spec-"));
    const cfg = join(dir, "clickmonkey.json");
    seed(cfg);
    stampFog(cfg, "home", { at: "2026-04-01T00:00:00.000Z", job: "map" });
    const specState = {
      configPath: cfg,
      pageId: "home",
      lastFogPageId: undefined as string | undefined,
      brain: "spec",
    };
    recordFog(specState);
    const afterSpec = fogOf(loadMapPages(cfg), "home");
    assert.ok(afterSpec?.spec);
    assert.equal(afterSpec?.jobs.map, "2026-04-01T00:00:00.000Z");
    assert.equal(afterSpec?.jobs.unleash, undefined);
    assert.deepEqual(jobFogOf(afterSpec)?.spec, afterSpec?.spec);
    const testState = {
      configPath: cfg,
      pageId: "home",
      lastFogPageId: specState.lastFogPageId,
      brain: "test",
    };
    recordFog(testState);
    assert.equal(fogOf(loadMapPages(cfg), "home")?.spec, afterSpec?.spec);
    testState.lastFogPageId = undefined;
    recordFog(testState);
    const afterTest = fogOf(loadMapPages(cfg), "home");
    assert.ok(afterTest?.spec);
    assert.notEqual(afterTest?.spec, afterSpec?.spec);
    assert.equal(afterTest?.jobs.map, "2026-04-01T00:00:00.000Z");
    resetFog(cfg, "spec");
    const afterReset = fogOf(loadMapPages(cfg), "home");
    assert.equal(afterReset?.spec, undefined);
    assert.equal(afterReset?.jobs.map, "2026-04-01T00:00:00.000Z");
    assert.ok(afterReset?.at);
    const merged = mergePageFog(
      { at: "2026-04-01T00:00:00.000Z", jobs: {}, modes: {}, spec: "2026-01-01T00:00:00.000Z" },
      { at: "2026-04-01T00:00:00.000Z", jobs: {}, modes: {}, spec: "2026-08-01T00:00:00.000Z" },
    );
    assert.equal(merged?.spec, "2026-08-01T00:00:00.000Z");
  });
});

describe("mergeLaterClocks", () => {
  it("keeps the later ISO per key and inserts missing keys", () => {
    const into = { home: "2026-01-01T00:00:00.000Z", invoices: "2026-06-01T00:00:00.000Z" };
    mergeLaterClocks(into, {
      home: "2026-08-01T00:00:00.000Z",
      invoices: "2026-03-01T00:00:00.000Z",
      extra: "2026-07-01T00:00:00.000Z",
    });
    assert.equal(into.home, "2026-08-01T00:00:00.000Z");
    assert.equal(into.invoices, "2026-06-01T00:00:00.000Z");
    assert.equal(into.extra, "2026-07-01T00:00:00.000Z");
  });
});

describe("scout fog hunger", () => {
  it("prefers a never-landed room over a room landed an hour ago", () => {
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
            { id: "go", by: "testId", value: "go", status: "ok", opens: "fresh" },
            { id: "old", by: "testId", value: "old", status: "ok", opens: "stale" },
          ],
        },
      ],
    };
    const room = (id: string): Page => ({
      id,
      path: `/${id}`,
      params: [],
      ready: { by: "testId", value: id },
      surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
    });
    const view: View = {
      page: "home",
      surface: "page",
      stack: ["page"],
      shown: [],
      actions: [{ id: "go", opens: "fresh" }],
      pages: ["home", "fresh", "stale"],
    };
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const d = decideMapScout(
      {
        view,
        stepsUsed: 4,
        pages: [home, room("fresh"), room("stale")],
        pageVisits: { "home/page": 4, "fresh/page": 1, "stale/page": 0 },
        pageFog: { home: hourAgo, fresh: hourAgo },
      },
      () => 0,
    );
    assert.equal(d?.line, "open stale");
    assert.ok(npcHunger(0, 60 * 60 * 1000) < npcHunger(0, FOG_OLD_MS));
    assert.equal(staleMsForPage({}, "missing"), FOG_OLD_MS);
    const future = new Date(Date.now() + 60_000).toISOString();
    assert.equal(staleMsForPage({ home: future }, "home"), 0);
  });
});
