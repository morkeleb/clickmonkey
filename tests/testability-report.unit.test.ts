import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  loadTestabilityReport,
  persistTestabilityPage,
  testabilityReportPath,
} from "../src/persist/testability.js";

describe("testability report", () => {
  it("replaces the entry for a path and stays out of the map", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-a11y-"));
    const configPath = join(dir, "clickmonkey.json");
    persistTestabilityPage(configPath, {
      path: "/",
      foundAt: "2026-08-14T00:00:00.000Z",
      insufficient: true,
      issues: [{ code: "opaqueControl", severity: "block", tag: "button" }],
    });
    persistTestabilityPage(configPath, {
      path: "/",
      foundAt: "2026-08-14T00:00:01.000Z",
      insufficient: false,
      issues: [{ code: "unlabeledField", severity: "warn", tag: "input", inputType: "text" }],
    });
    persistTestabilityPage(configPath, {
      path: "/shop",
      foundAt: "2026-08-14T00:00:02.000Z",
      insufficient: false,
      issues: [],
    });
    const report = loadTestabilityReport(testabilityReportPath(configPath));
    assert.equal(report.pages.length, 2);
    const home = report.pages.find((p) => p.path === "/");
    assert.ok(home);
    assert.equal(home.insufficient, false);
    assert.equal(home.issues.length, 1);
    assert.equal(home.issues[0]?.code, "unlabeledField");
    assert.ok(report.pages.some((p) => p.path === "/shop"));
  });

  it("keeps the same path on different origins apart", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-a11y-origin-"));
    const configPath = join(dir, "clickmonkey.json");
    persistTestabilityPage(configPath, {
      path: "/login",
      foundAt: "t1",
      insufficient: false,
      issues: [{ code: "noMain", severity: "warn", tag: "document" }],
    });
    persistTestabilityPage(configPath, {
      path: "/login",
      origin: "https://idp.example.com",
      foundAt: "t2",
      insufficient: true,
      issues: [{ code: "opaqueControl", severity: "block", tag: "button" }],
    });
    const report = loadTestabilityReport(testabilityReportPath(configPath));
    assert.equal(report.pages.length, 2);
    const app = report.pages.find((p) => p.path === "/login" && !p.origin);
    const idp = report.pages.find((p) => p.origin === "https://idp.example.com");
    assert.equal(app?.insufficient, false);
    assert.equal(idp?.insufficient, true);
  });
});
