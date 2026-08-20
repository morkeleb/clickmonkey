import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { withRun } from "../src/executor/session.js";
import { buildView } from "../src/executor/view.js";
import { emptyConfig } from "../src/schema/config.js";
import { emptyDraft } from "../src/schema/index.js";
import { loadTestabilityReport, testabilityReportPath } from "../src/persist/testability.js";
import { inspect, inspectAndSaveConfig } from "../src/surveyor/inspect.js";
import { serveSite } from "./helpers/fixture-server.js";

describe("testability audit", () => {
  it("marks an opaque page insufficient with deterministic codes", async () => {
    const { baseUrl, close } = await serveSite("opaque");
    try {
      await withRun({}, async ({ page }) => {
        await page.goto(baseUrl);
        const result = await inspect(page, { model: emptyDraft() });
        assert.equal(result.testability.insufficient, true);
        const codes = result.testability.issues.map((i) => i.code);
        assert.ok(codes.includes("opaqueControl"));
        assert.ok(codes.includes("clickableNonWidget"));
        assert.ok(codes.includes("unnamedDialog"));
        assert.ok(codes.includes("unlabeledField"));
        assert.ok(codes.includes("unnamedControl"));
        assert.ok(codes.includes("noMain"));
        const view = await buildView({
          page,
          pageId: result.pageId,
          surfaceStack: result.surfaceStack,
          model: result.model,
        });
        assert.equal(view.testability?.insufficient, true);
        assert.ok(view.testability?.issues.some((i) => i.code === "opaqueControl"));
      });
    } finally {
      await close();
    }
  });

  it("warns on duplicate names but still offers a click", async () => {
    const { baseUrl, close } = await serveSite("dup-name");
    try {
      await withRun({}, async ({ page }) => {
        await page.goto(baseUrl);
        const result = await inspect(page, { model: emptyDraft("dup") });
        assert.equal(result.testability.insufficient, false);
        assert.ok(
          result.testability.issues.some((i) => i.code === "duplicateName" && i.severity === "warn"),
          JSON.stringify(result.testability.issues),
        );
        const dup = result.testability.issues.find((i) => i.code === "duplicateName");
        assert.match(dup?.where ?? "", /Settings/i);
        const pageSurf = result.model.pages[0]?.surfaces.find((s) => s.kind === "page");
        const settings = pageSurf?.actions.find((a) => a.name === "Settings" || a.id.includes("settings"));
        assert.ok(settings, "settings action minted");
        assert.equal(settings.status, "ok");
        const view = await buildView({
          page,
          pageId: result.pageId,
          surfaceStack: result.surfaceStack,
          model: result.model,
        });
        assert.ok(view.actions.some((a) => a.id === settings.id));
        assert.ok(view.testability?.issues.some((i) => i.code === "duplicateName"));
      });
    } finally {
      await close();
    }
  });

  it("does not block a labeled catalog page", async () => {
    const { baseUrl, close } = await serveSite("catalog");
    try {
      await withRun({}, async ({ page }) => {
        await page.goto(baseUrl);
        const result = await inspect(page, { model: emptyDraft() });
        assert.equal(result.testability.insufficient, false);
        assert.equal(
          result.testability.issues.some((i) => i.severity === "block"),
          false,
        );
        assert.ok(
          result.testability.issues.some((i) => i.code === "missingStableId" && i.severity === "warn"),
          JSON.stringify(result.testability.issues),
        );
        const missing = result.testability.issues.find((i) => i.code === "missingStableId" && i.tag === "a");
        assert.match(missing?.where ?? "", /Account/);
      });
    } finally {
      await close();
    }
  });

  it("does not warn missingStableId when every field and click has a hook", async () => {
    const { baseUrl, close } = await serveSite("validates");
    try {
      await withRun({}, async ({ page }) => {
        await page.goto(baseUrl);
        const result = await inspect(page, { model: emptyDraft() });
        assert.equal(
          result.testability.issues.some((i) => i.code === "missingStableId"),
          false,
          JSON.stringify(result.testability.issues),
        );
      });
    } finally {
      await close();
    }
  });

  it("persists a replaced page entry next to the config", async () => {
    const { baseUrl, close } = await serveSite("opaque");
    const dir = mkdtempSync(join(tmpdir(), "cm-a11y-live-"));
    const configPath = join(dir, "clickmonkey.json");
    writeFileSync(configPath, `${JSON.stringify(emptyConfig(baseUrl), null, 2)}\n`);
    try {
      await withRun({}, async ({ page }) => {
        await page.goto(baseUrl);
        await inspectAndSaveConfig(page, configPath);
        const report = loadTestabilityReport(testabilityReportPath(configPath));
        assert.equal(report.pages.length, 1);
        assert.equal(report.pages[0]?.path, "/");
        assert.equal(report.pages[0]?.insufficient, true);
        assert.ok(report.pages[0]?.issues.some((i) => i.code === "opaqueControl"));
      });
    } finally {
      await close();
    }
  });
});
