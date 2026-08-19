import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { persistBrokenEntry, loadBrokenReport, brokenReportPath } from "../src/persist/broken.js";

describe("broken report", () => {
  it("unions entries by path+status and stays out of the map", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-broken-"));
    const configPath = join(dir, "clickmonkey.json");
    persistBrokenEntry(configPath, {
      path: "/missing",
      url: "http://127.0.0.1/missing",
      status: 404,
      foundAt: "2026-08-14T00:00:00.000Z",
      resourceType: "document",
    });
    persistBrokenEntry(configPath, {
      path: "/missing",
      url: "http://127.0.0.1/missing",
      status: 404,
      foundAt: "2026-08-14T00:00:01.000Z",
      resourceType: "document",
    });
    persistBrokenEntry(configPath, {
      path: "/gone",
      url: "http://127.0.0.1/gone",
      status: 404,
      foundAt: "2026-08-14T00:00:02.000Z",
      resourceType: "document",
    });
    const report = loadBrokenReport(brokenReportPath(configPath));
    assert.equal(report.entries.length, 2);
    assert.deepEqual(
      report.entries.map((e) => e.path).sort(),
      ["/gone", "/missing"],
    );
  });
});
