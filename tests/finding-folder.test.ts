import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { appendFindingReport, persistFinding } from "../src/persist/finding.js";
import { cannedReport } from "../src/reports/canned.js";
import { Finding, findingId } from "../src/schema/finding.js";

describe("finding folder", () => {
  it("writes finding.json, canned report.md, and optional screenshot", () => {
    const outDir = mkdtempSync(join(tmpdir(), "cm-fnd-"));
    const finding: Finding = {
      schemaVersion: 1,
      id: findingId(3, "expectFailed"),
      kind: "expectFailed",
      message: "expected invalid, field is valid",
      tapePath: join(outDir, "replay.log"),
      stepIndex: 3,
    };
    const shot = join(outDir, "tmp.png");
    writeFileSync(shot, "png");
    persistFinding(outDir, finding, {
      screenshotPath: shot,
      replayLog: "open home\n",
    });

    const dir = join(outDir, "findings", finding.id);
    assert.ok(existsSync(dir));
    const parsed = Finding.parse(JSON.parse(readFileSync(join(dir, "finding.json"), "utf8")));
    assert.equal(parsed.kind, "expectFailed");
    assert.equal(parsed.severity, "major");
    const report = readFileSync(join(dir, "report.md"), "utf8");
    assert.equal(report, cannedReport(finding));
    assert.match(report, /Expected validation \/ expect failed/);
    assert.ok(existsSync(join(dir, "screenshot.png")));
    assert.equal(parsed.screenshotPath, join(dir, "screenshot.png"));
    assert.ok(existsSync(join(dir, "replay.log")));
    assert.equal(parsed.tapePath, join(dir, "replay.log"));
  });

  it("does not unlink a screenshot that already lives under findings/", () => {
    const outDir = mkdtempSync(join(tmpdir(), "cm-fnd-keep-"));
    const first: Finding = {
      schemaVersion: 1,
      id: findingId(1, "uiIssue"),
      kind: "uiIssue",
      message: "overlap",
      tapePath: join(outDir, "replay.log"),
      stepIndex: 1,
    };
    const shot = join(outDir, "tmp.png");
    writeFileSync(shot, "png-a");
    persistFinding(outDir, first, { screenshotPath: shot });
    const kept = first.screenshotPath!;
    assert.ok(existsSync(kept));
    const second: Finding = {
      schemaVersion: 1,
      id: findingId(2, "expectFailed"),
      kind: "expectFailed",
      message: "expected invalid",
      tapePath: join(outDir, "replay.log"),
      stepIndex: 2,
    };
    persistFinding(outDir, second, { screenshotPath: kept });
    assert.ok(existsSync(kept), "first finding screenshot must survive");
    assert.ok(existsSync(join(outDir, "findings", second.id, "screenshot.png")));
  });

  it("appends extra markdown to report.md", () => {
    const outDir = mkdtempSync(join(tmpdir(), "cm-fnd-append-"));
    const finding: Finding = {
      schemaVersion: 1,
      id: findingId(1, "uiIssue"),
      kind: "uiIssue",
      message: "overlap",
      tapePath: join(outDir, "replay.log"),
      stepIndex: 1,
    };
    persistFinding(outDir, finding);
    appendFindingReport(outDir, finding.id, "What happened: buttons overlap.");
    const report = readFileSync(join(outDir, "findings", finding.id, "report.md"), "utf8");
    assert.match(report, /UI issue captured from an explicit screenshot step/);
    assert.match(report, /What happened: buttons overlap/);
  });
});
