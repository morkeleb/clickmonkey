import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { bootRun } from "../src/executor/boot.js";
import { createExecutor } from "../src/executor/run.js";
import { withRun } from "../src/executor/session.js";
import { loadBrokenReport, brokenReportPath } from "../src/persist/broken.js";
import { saveConfig } from "../src/persist/config.js";
import { emptyConfig } from "../src/schema/config.js";
import { serveSite } from "./helpers/fixture-server.js";

describe("document 404", () => {
  it("records a Finding and a broken report, not a map page", async () => {
    const server = await serveSite("broken");
    const dir = mkdtempSync(join(tmpdir(), "cm-404-"));
    const configPath = join(dir, "clickmonkey.json");
    const config = emptyConfig(server.baseUrl, "fixture");
    saveConfig(configPath, config);
    try {
      await withRun({}, async (handle) => {
        const state = await bootRun(handle, config, join(dir, "run"), { configPath });
        const exec = createExecutor(state);
        const result = await exec.runLine("click page.dead_link");
        assert.equal(result.ok, false);
        assert.equal(result.finding?.kind, "notFound");
        assert.equal(result.finding?.httpStatus, 404);
        const report = loadBrokenReport(brokenReportPath(configPath));
        assert.ok(report.entries.some((e) => e.path === "/missing" && e.status === 404));
        assert.ok(!state.model.pages.some((p) => p.path === "/missing"));
        assert.ok(!("deadPaths" in state.model));
      });
    } finally {
      await server.close();
    }
  });

  it("records a Next.js-style 404 page even when HTTP is 200", async () => {
    const server = await serveSite("next-404");
    const dir = mkdtempSync(join(tmpdir(), "cm-next-404-"));
    const configPath = join(dir, "clickmonkey.json");
    const config = emptyConfig(server.baseUrl, "fixture");
    saveConfig(configPath, config);
    try {
      await withRun({}, async (handle) => {
        const state = await bootRun(handle, config, join(dir, "run"), { configPath });
        const exec = createExecutor(state);
        const result = await exec.runLine("click page.dead_card");
        assert.equal(result.ok, false);
        assert.equal(result.finding?.kind, "notFound");
        assert.match(result.finding?.message ?? "", /Not found page|HTTP 404/);
        assert.ok(!state.model.pages.some((p) => p.path.includes("gone")));
      });
    } finally {
      await server.close();
    }
  });

  it("records a client-side layout 404 (HTTP 200, no next-error-h1)", async () => {
    const server = await serveSite("next-404");
    const dir = mkdtempSync(join(tmpdir(), "cm-spa-404-"));
    const configPath = join(dir, "clickmonkey.json");
    const config = emptyConfig(server.baseUrl, "fixture");
    saveConfig(configPath, config);
    try {
      await withRun({}, async (handle) => {
        const state = await bootRun(handle, config, join(dir, "run"), { configPath });
        const exec = createExecutor(state);
        const result = await exec.runLine("click page.spa_dead");
        assert.equal(result.ok, false);
        assert.equal(result.finding?.kind, "notFound");
        assert.match(result.finding?.message ?? "", /Not found page/);
        assert.equal(result.finding?.httpStatus, 404);
        assert.ok(!state.model.pages.some((p) => p.path.includes("applications")));
        const report = loadBrokenReport(brokenReportPath(configPath));
        assert.ok(report.entries.some((e) => e.path === "/applications" && e.status === 404));
        assert.equal(existsSync(join(dir, "run", "shots", "pages", "home.png")), false);
      });
    } finally {
      await server.close();
    }
  });
});
