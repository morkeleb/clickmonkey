import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { bootRun } from "../src/executor/boot.js";
import { createExecutor } from "../src/executor/run.js";
import { withRun } from "../src/executor/session.js";
import { loadQualityReport, qualityReportPath } from "../src/persist/quality.js";
import { loadTestabilityReport, testabilityReportPath } from "../src/persist/testability.js";
import { emptyConfig } from "../src/schema/config.js";
import { inspectAndSaveConfig } from "../src/surveyor/inspect.js";
import { serveSite } from "./helpers/fixture-server.js";

describe("quality walk ledger", () => {
  it("inspect persists testability, HTML, and axe issues", async () => {
    const { baseUrl, close } = await serveSite("quality");
    const dir = mkdtempSync(join(tmpdir(), "cm-quality-live-"));
    const configPath = join(dir, "clickmonkey.json");
    writeFileSync(configPath, `${JSON.stringify(emptyConfig(baseUrl), null, 2)}\n`);
    try {
      await withRun({}, async ({ page }) => {
        await page.goto(baseUrl);
        await inspectAndSaveConfig(page, configPath);
        const testability = loadTestabilityReport(testabilityReportPath(configPath));
        assert.equal(testability.pages[0]?.path, "/");
        assert.ok(
          testability.pages[0]?.issues.some((i) => i.code === "noMain"),
          JSON.stringify(testability.pages[0]?.issues),
        );
        const quality = loadQualityReport(qualityReportPath(configPath));
        const htmlRules = quality.pages[0]?.html.map((i) => i.rule) ?? [];
        assert.ok(htmlRules.includes("no-dup-id"), JSON.stringify(quality.pages[0]?.html));
        const a11yRules = quality.pages[0]?.a11y.map((i) => i.rule) ?? [];
        assert.ok(a11yRules.includes("image-alt"), JSON.stringify(quality.pages[0]?.a11y));
      });
    } finally {
      await close();
    }
  });

  it("boot records JS console and pageerror without flooding findings", async () => {
    const { baseUrl, close } = await serveSite("quality");
    const dir = mkdtempSync(join(tmpdir(), "cm-quality-js-"));
    const configPath = join(dir, "clickmonkey.json");
    writeFileSync(configPath, `${JSON.stringify(emptyConfig(baseUrl), null, 2)}\n`);
    try {
      await withRun({}, async (handle) => {
        const state = await bootRun(handle, emptyConfig(baseUrl), join(dir, "run"), { configPath });
        const quality = loadQualityReport(qualityReportPath(configPath));
        const runtime = quality.pages[0]?.runtime ?? [];
        const rules = runtime.map((e) => e.rule);
        assert.ok(rules.includes("console.warning"), JSON.stringify(runtime));
        assert.ok(rules.includes("console.error"), JSON.stringify(runtime));
        assert.ok(rules.includes("pageError"), JSON.stringify(runtime));
        assert.ok(runtime.some((e) => e.message.includes("cm-quality-boom")));
        const exec = createExecutor(state);
        const first = await exec.runLine("screenshot after-load");
        assert.equal(first.finding?.kind, "pageError");
        const second = await exec.runLine("screenshot again");
        assert.notEqual(second.finding?.kind, "pageError");
      });
    } finally {
      await close();
    }
  });
});
