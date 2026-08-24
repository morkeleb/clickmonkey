import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FOG_OLD_MS, npcHunger, staleMsForPage } from "../src/brains/npc.js";
import { saveConfig } from "../src/persist/config.js";
import { landsPath, loadLands, recordLand, recordMode, shouldStampLand, touchLand } from "../src/persist/lands.js";
import { jobLandTimes, jobLandsOf, jobOfBrain, landTimes, modeLandTimes, monkeyOfBrain } from "../src/schema/fog.js";
import { emptyConfig } from "../src/schema/config.js";
import { decideMapScout } from "../src/brains/map-scout.js";
import type { Page } from "../src/schema/page-model.js";
import type { View } from "../src/schema/view.js";

describe("lands ledger", () => {
  it("records last land per page and skips a repeat on the same stay", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-lands-"));
    const cfg = join(dir, "clickmonkey.json");
    saveConfig(cfg, emptyConfig("http://127.0.0.1:4173/"));
    const first = touchLand(cfg, "home", "2026-01-01T00:00:00.000Z");
    assert.equal(first.pages.home?.at, "2026-01-01T00:00:00.000Z");
    touchLand(cfg, "invoices", "2026-06-01T00:00:00.000Z");
    const loaded = loadLands(cfg);
    assert.equal(loaded.pages.home?.at, "2026-01-01T00:00:00.000Z");
    assert.equal(loaded.pages.invoices?.at, "2026-06-01T00:00:00.000Z");
    const state = {
      configPath: cfg,
      pageId: "home",
      lastLandPageId: undefined as string | undefined,
      brain: "unleash",
    };
    recordLand(state);
    assert.equal(state.lastLandPageId, "home");
    const after = loadLands(cfg).pages.home?.at;
    recordLand(state);
    assert.equal(loadLands(cfg).pages.home?.at, after);
    assert.ok(loadLands(cfg).pages.home?.jobs.unleash);
  });

  it("skips replay and does not overwrite an unreadable lands.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-lands-bad-"));
    const cfg = join(dir, "clickmonkey.json");
    saveConfig(cfg, emptyConfig("http://127.0.0.1:4173/"));
    const path = landsPath(cfg);
    const state = { configPath: cfg, replay: true, pageId: "home" };
    recordLand(state);
    assert.deepEqual(loadLands(cfg).pages, {});
    mkdirSync(join(dir, "clickmonkey"), { recursive: true });
    writeFileSync(path, "{not json\n", "utf8");
    const before = readFileSync(path, "utf8");
    touchLand(cfg, "home", "2026-01-01T00:00:00.000Z");
    assert.equal(readFileSync(path, "utf8"), before);
    assert.deepEqual(loadLands(cfg).pages, {});
  });

  it("does not stamp a land on 404 or replay", () => {
    assert.equal(shouldStampLand({}, true), false);
    assert.equal(shouldStampLand({ replay: true }, false), false);
    assert.equal(shouldStampLand({ replay: false }, false), true);
  });

  it("migrates v1 lands and keeps separate job and mode clocks", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-lands-v1-"));
    const cfg = join(dir, "clickmonkey.json");
    saveConfig(cfg, emptyConfig("http://127.0.0.1:4173/"));
    mkdirSync(join(dir, "clickmonkey"), { recursive: true });
    writeFileSync(
      landsPath(cfg),
      `${JSON.stringify({ schemaVersion: 1, pages: { home: "2026-01-01T00:00:00.000Z" } })}\n`,
      "utf8",
    );
    const migrated = loadLands(cfg);
    assert.equal(migrated.schemaVersion, 2);
    assert.equal(migrated.pages.home?.at, "2026-01-01T00:00:00.000Z");
    assert.deepEqual(landTimes(migrated), { home: "2026-01-01T00:00:00.000Z" });
    assert.deepEqual(jobLandTimes(migrated, "unleash"), {});
    touchLand(cfg, "home", { at: "2026-03-01T00:00:00.000Z", job: "map" });
    touchLand(cfg, "home", { at: "2026-04-01T00:00:00.000Z", job: "unleash" });
    recordMode({ configPath: cfg }, "home", "list");
    const next = loadLands(cfg);
    assert.equal(jobLandTimes(next, "map").home, "2026-03-01T00:00:00.000Z");
    assert.equal(jobLandTimes(next, "unleash").home, "2026-04-01T00:00:00.000Z");
    assert.deepEqual(jobLandsOf(next.pages.home), {
      map: "2026-03-01T00:00:00.000Z",
      unleash: "2026-04-01T00:00:00.000Z",
    });
    assert.equal(jobLandsOf(undefined), undefined);
    assert.ok(modeLandTimes(next)["home/list"]);
    assert.equal(jobOfBrain("unleash-nasty"), "nasty");
    assert.equal(jobOfBrain("map"), "map");
    assert.equal(jobOfBrain("explore"), undefined);
    assert.equal(monkeyOfBrain("unleash-nasty"), "nasty");
    assert.equal(monkeyOfBrain("explore"), "explore");
    assert.equal(monkeyOfBrain("mcp"), "mcp");
    assert.equal(monkeyOfBrain("spec"), undefined);
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
        pageLands: { home: hourAgo, fresh: hourAgo },
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
