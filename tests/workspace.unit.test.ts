import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadConfig, saveConfig } from "../src/persist/config.js";
import { persistQualitySnapshot, qualityReportPath } from "../src/persist/quality.js";
import { persistTestabilityPage, testabilityReportPath } from "../src/persist/testability.js";
import { persistBrokenEntry, brokenReportPath } from "../src/persist/broken.js";
import { listRuns } from "../src/persist/runs.js";
import {
  brokenPath,
  mapPath,
  qualityPath,
  testabilityPath,
  workspaceDir,
} from "../src/persist/workspace.js";
import { emptyConfig } from "../src/schema/config.js";

describe("workspace layout", () => {
  it("saveConfig writes a leash without map and seeds clickmonkey/map.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-ws-"));
    const path = join(dir, "clickmonkey.json");
    saveConfig(path, emptyConfig("http://127.0.0.1:4173/", "fixture"));
    const leash = JSON.parse(readFileSync(path, "utf8")) as { map?: unknown; url: string };
    assert.equal(leash.url, "http://127.0.0.1:4173/");
    assert.equal(leash.map, undefined);
    assert.ok(existsSync(mapPath(path)));
    const loaded = loadConfig(path);
    assert.equal(loaded.map.app, "fixture");
    assert.equal(loaded.map.pages.length, 0);
    assert.equal(workspaceDir(path), join(dir, "clickmonkey"));
  });

  it("loadConfig overlays clickmonkey/dev-origin onto the leash path", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-ws-origin-"));
    const path = join(dir, "clickmonkey.json");
    saveConfig(path, emptyConfig("http://127.0.0.1:3000/api/auth/test-login/", "app"));
    mkdirSync(join(dir, "clickmonkey"), { recursive: true });
    writeFileSync(join(dir, "clickmonkey", "dev-origin"), "http://127.0.0.1:3001\n");
    const loaded = loadConfig(path);
    assert.equal(loaded.url, "http://127.0.0.1:3001/api/auth/test-login/");
    saveConfig(path, loaded);
    const leash = JSON.parse(readFileSync(path, "utf8")) as { url: string };
    assert.equal(leash.url, "http://127.0.0.1:3000/api/auth/test-login/");
  });

  it("loadConfig still reads an inline map when map.json is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-ws-inline-"));
    const path = join(dir, "clickmonkey.json");
    writeFileSync(
      path,
      `${JSON.stringify({
        url: "http://127.0.0.1:4173/",
        map: { schemaVersion: 1, app: "legacy", pages: [] },
      })}\n`,
    );
    const loaded = loadConfig(path);
    assert.equal(loaded.map.app, "legacy");
    assert.equal(existsSync(mapPath(path)), false);
  });

  it("testability and broken ledgers land in the workspace folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-ws-ledgers-"));
    const path = join(dir, "clickmonkey.json");
    saveConfig(path, emptyConfig("http://127.0.0.1:4173/"));
    persistTestabilityPage(path, {
      path: "/",
      foundAt: "2026-08-17T00:00:00.000Z",
      insufficient: false,
      issues: [],
    });
    persistQualitySnapshot(path, {
      path: "/",
      foundAt: "2026-08-17T00:00:00.000Z",
      html: [],
      a11y: [],
    });
    persistBrokenEntry(path, {
      path: "/missing",
      url: "http://127.0.0.1:4173/missing",
      status: 404,
      foundAt: "2026-08-17T00:00:00.000Z",
      resourceType: "document",
    });
    assert.equal(testabilityReportPath(path), testabilityPath(path));
    assert.equal(qualityReportPath(path), qualityPath(path));
    assert.equal(brokenReportPath(path), brokenPath(path));
    assert.ok(existsSync(testabilityPath(path)));
    assert.ok(existsSync(qualityPath(path)));
    assert.ok(existsSync(brokenPath(path)));
  });

  it("walk ledgers land in the run folder, not the workspace pile", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-ws-run-ledger-"));
    const path = join(dir, "clickmonkey.json");
    const outDir = join(dir, "clickmonkey", "runs", "20260820T000000Z-abcd");
    saveConfig(path, emptyConfig("http://127.0.0.1:4173/"));
    persistTestabilityPage(
      path,
      { path: "/", foundAt: "t", insufficient: false, issues: [] },
      outDir,
    );
    persistQualitySnapshot(path, { path: "/", foundAt: "t", html: [], a11y: [] }, outDir);
    persistBrokenEntry(
      path,
      {
        path: "/missing",
        url: "http://127.0.0.1:4173/missing",
        status: 404,
        foundAt: "t",
        resourceType: "document",
      },
      outDir,
    );
    assert.ok(existsSync(join(outDir, "testability.json")));
    assert.ok(existsSync(join(outDir, "quality.json")));
    assert.ok(existsSync(join(outDir, "broken.json")));
    assert.equal(existsSync(testabilityPath(path)), false);
    assert.equal(existsSync(qualityPath(path)), false);
    assert.equal(existsSync(brokenPath(path)), false);
  });

  it("prefers a rich inline map over an empty seeded map.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-ws-inline-rich-"));
    const path = join(dir, "clickmonkey.json");
    saveConfig(path, emptyConfig("http://127.0.0.1:4173/", "seed"));
    writeFileSync(
      path,
      `${JSON.stringify({
        url: "http://127.0.0.1:4173/",
        map: {
          schemaVersion: 1,
          app: "legacy",
          pages: [
            {
              id: "home",
              path: "/",
              ready: { by: "testId", value: "home" },
              surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
            },
          ],
        },
      })}\n`,
    );
    const loaded = loadConfig(path);
    assert.equal(loaded.map.app, "legacy");
    assert.equal(loaded.map.pages[0]?.id, "home");
    saveConfig(path, loaded);
    const onDisk = JSON.parse(readFileSync(mapPath(path), "utf8")) as { app: string; pages: { id: string }[] };
    assert.equal(onDisk.app, "legacy");
    assert.equal(onDisk.pages[0]?.id, "home");
    const leash = JSON.parse(readFileSync(path, "utf8")) as { map?: unknown };
    assert.equal(leash.map, undefined);
  });

  it("listRuns includes legacy ./runs when the workspace folder is empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-ws-legacy-runs-"));
    const path = join(dir, "clickmonkey.json");
    saveConfig(path, emptyConfig("http://127.0.0.1:4173/"));
    const legacy = join(dir, "runs", "old-sess");
    mkdirSync(join(legacy, "findings", "fnd_0_expectFailed"), { recursive: true });
    writeFileSync(
      join(legacy, "findings", "fnd_0_expectFailed", "finding.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        id: "fnd_0_expectFailed",
        kind: "expectFailed",
        message: "x",
        tapePath: join(legacy, "replay.log"),
        stepIndex: 0,
      })}\n`,
    );
    const runs = listRuns(path);
    assert.ok(runs.some((r) => r.id === "old-sess" && r.findingCount === 1));
    mkdirSync(join(dir, "clickmonkey", "runs", "view-empty"), { recursive: true });
    assert.equal(
      listRuns(path).some((r) => r.id === "view-empty"),
      false,
    );
  });
});
