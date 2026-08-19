import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { bootRun } from "../src/executor/boot.js";
import { createExecutor } from "../src/executor/run.js";
import { withRun } from "../src/executor/session.js";
import { saveConfig } from "../src/persist/config.js";
import { emptyConfig } from "../src/schema/config.js";
import { serveSite } from "./helpers/fixture-server.js";

describe("auto screenshot", () => {
  it("writes step-000.png after a non-screenshot step", async () => {
    const { baseUrl, close } = await serveSite("catalog");
    const tmp = mkdtempSync(join(tmpdir(), "cm-auto-shot-"));
    const configPath = join(tmp, "clickmonkey.json");
    saveConfig(configPath, emptyConfig(baseUrl));
    try {
      await withRun({}, async (handle) => {
        const state = await bootRun(handle, emptyConfig(baseUrl), tmp, { configPath });
        const exec = createExecutor(state);
        const result = await exec.runLine("expect path /");
        assert.equal(result.ok, true, result.finding?.message);
        assert.equal(state.log.steps.length, 1);
        assert.equal(state.log.steps[0]?.kind, "expectPath");
        const shot = join(tmp, "shots", "step-000.png");
        assert.ok(existsSync(shot), shot);
        assert.equal(state.lastScreenshotPath, shot);
        assert.ok(existsSync(join(tmp, "shots", "pages", `${state.pageId}.png`)));
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await close();
    }
  });

  it("skips auto shots when screenshots is false", async () => {
    const { baseUrl, close } = await serveSite("catalog");
    const tmp = mkdtempSync(join(tmpdir(), "cm-auto-shot-off-"));
    const configPath = join(tmp, "clickmonkey.json");
    const config = { ...emptyConfig(baseUrl), screenshots: false };
    saveConfig(configPath, config);
    try {
      await withRun({}, async (handle) => {
        const state = await bootRun(handle, config, tmp, { configPath });
        const exec = createExecutor(state);
        const result = await exec.runLine("expect path /");
        assert.equal(result.ok, true, result.finding?.message);
        assert.equal(existsSync(join(tmp, "shots", "step-000.png")), false);
        assert.equal(existsSync(join(tmp, "shots")), false);
        assert.equal(state.lastScreenshotPath, undefined);
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await close();
    }
  });

  it("DSL screenshot writes a labeled file and not an unlabeled auto shot", async () => {
    const { baseUrl, close } = await serveSite("catalog");
    const tmp = mkdtempSync(join(tmpdir(), "cm-auto-shot-dsl-"));
    const configPath = join(tmp, "clickmonkey.json");
    saveConfig(configPath, emptyConfig(baseUrl));
    try {
      await withRun({}, async (handle) => {
        const state = await bootRun(handle, emptyConfig(baseUrl), tmp, { configPath });
        const exec = createExecutor(state);
        const result = await exec.runLine("screenshot after-load");
        assert.equal(result.ok, true, result.finding?.message);
        const labeled = join(tmp, "shots", "step-000-after_load.png");
        assert.ok(existsSync(labeled), labeled);
        assert.equal(state.lastScreenshotPath, labeled);
        assert.equal(existsSync(join(tmp, "shots", "step-000.png")), false);
        const names = readdirSync(join(tmp, "shots"));
        assert.ok(names.includes("step-000-after_load.png"));
        assert.ok(names.includes("pages"));
        assert.ok(existsSync(join(tmp, "shots", "pages", `${state.pageId}.png`)));
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await close();
    }
  });
});
