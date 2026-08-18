import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { bootRun } from "../src/executor/boot.js";
import { createExecutor } from "../src/executor/run.js";
import { withRun } from "../src/executor/session.js";
import { saveConfig } from "../src/persist/config.js";
import { emptyConfig } from "../src/schema/config.js";
import { serveSite } from "./helpers/fixture-server.js";

describe("screenshot step", () => {
  it("writes a shot without a finding", async () => {
    const { baseUrl, close } = await serveSite("catalog");
    const tmp = mkdtempSync(join(tmpdir(), "cm-shot-"));
    const configPath = join(tmp, "clickmonkey.json");
    saveConfig(configPath, emptyConfig(baseUrl));
    try {
      await withRun({}, async (handle) => {
        const state = await bootRun(handle, emptyConfig(baseUrl), tmp, { configPath });
        const exec = createExecutor(state);
        const result = await exec.runLine("screenshot after-load");
        assert.equal(result.ok, true);
        assert.ok(state.lastScreenshotPath && existsSync(state.lastScreenshotPath));
        assert.match(state.lastScreenshotPath, /shots\/step-000-after_load\.png$/);
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await close();
    }
  });

  it("screenshot ui files a finding folder", async () => {
    const { baseUrl, close } = await serveSite("catalog");
    const tmp = mkdtempSync(join(tmpdir(), "cm-shot-ui-"));
    const configPath = join(tmp, "clickmonkey.json");
    saveConfig(configPath, emptyConfig(baseUrl));
    try {
      await withRun({}, async (handle) => {
        const state = await bootRun(handle, emptyConfig(baseUrl), tmp, { configPath });
        const exec = createExecutor(state);
        const result = await exec.runLine('screenshot ui "price looks cramped"');
        assert.equal(result.ok, false);
        assert.equal(result.finding?.kind, "uiIssue");
        assert.ok(result.finding?.screenshotPath && existsSync(result.finding.screenshotPath));
        assert.ok(state.lastScreenshotPath && existsSync(state.lastScreenshotPath));
        assert.equal(state.lastScreenshotPath, result.finding.screenshotPath);
        assert.ok(existsSync(join(tmp, "findings", result.finding!.id, "report.md")));
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await close();
    }
  });
});
