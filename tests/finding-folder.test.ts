import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { appendFindingReport, persistFinding, shouldPersistFinding } from "../src/persist/finding.js";
import { cannedReport } from "../src/reports/canned.js";
import { Finding, findingId } from "../src/schema/finding.js";

function findingFolders(outDir: string): string[] {
  const root = join(outDir, "findings");
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => existsSync(join(root, name, "finding.json")))
    .sort();
}

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

  it("dedups a second persist with the same kind and message", () => {
    const outDir = mkdtempSync(join(tmpdir(), "cm-fnd-dedup-"));
    const first: Finding = {
      schemaVersion: 1,
      id: findingId(1, "expectFailed"),
      kind: "expectFailed",
      message: "expected invalid, field is valid",
      tapePath: join(outDir, "replay.log"),
      stepIndex: 1,
    };
    const shot = join(outDir, "tmp.png");
    writeFileSync(shot, "png");
    const written = persistFinding(outDir, first, {
      screenshotPath: shot,
      replayLog: "open home\n",
    });
    assert.equal(written.created, true);
    const second: Finding = {
      schemaVersion: 1,
      id: findingId(4, "expectFailed"),
      kind: "expectFailed",
      message: "expected invalid, field is valid",
      tapePath: join(outDir, "replay.log"),
      stepIndex: 4,
    };
    const again = persistFinding(outDir, second);
    assert.equal(again.created, false);
    assert.equal(again.finding.id, written.finding.id);
    assert.deepEqual(findingFolders(outDir), [written.finding.id]);
    const dir = join(outDir, "findings", written.finding.id);
    assert.ok(existsSync(join(dir, "finding.json")));
    assert.ok(existsSync(join(dir, "report.md")));
    assert.ok(existsSync(join(dir, "screenshot.png")));
  });

  it("writes a new folder when the message differs", () => {
    const outDir = mkdtempSync(join(tmpdir(), "cm-fnd-msg-"));
    persistFinding(outDir, {
      schemaVersion: 1,
      id: findingId(1, "expectFailed"),
      kind: "expectFailed",
      message: "expected invalid, field is valid",
      tapePath: join(outDir, "replay.log"),
      stepIndex: 1,
    });
    persistFinding(outDir, {
      schemaVersion: 1,
      id: findingId(2, "expectFailed"),
      kind: "expectFailed",
      message: "expected invalid, name is valid",
      tapePath: join(outDir, "replay.log"),
      stepIndex: 2,
    });
    assert.deepEqual(findingFolders(outDir), [findingId(1, "expectFailed"), findingId(2, "expectFailed")]);
  });

  it("keeps separate folders when both urls or widgetRefs differ", () => {
    const outDir = mkdtempSync(join(tmpdir(), "cm-fnd-key-"));
    persistFinding(outDir, {
      schemaVersion: 1,
      id: findingId(1, "httpError"),
      kind: "httpError",
      message: "HTTP 500",
      tapePath: join(outDir, "replay.log"),
      stepIndex: 1,
      url: "http://127.0.0.1/a",
    });
    persistFinding(outDir, {
      schemaVersion: 1,
      id: findingId(2, "httpError"),
      kind: "httpError",
      message: "HTTP 500",
      tapePath: join(outDir, "replay.log"),
      stepIndex: 2,
      url: "http://127.0.0.1/b",
    });
    persistFinding(outDir, {
      schemaVersion: 1,
      id: findingId(3, "locatorAmbiguous"),
      kind: "locatorAmbiguous",
      message: "two matches",
      tapePath: join(outDir, "replay.log"),
      stepIndex: 3,
      widgetRef: "page.save",
    });
    persistFinding(outDir, {
      schemaVersion: 1,
      id: findingId(4, "locatorAmbiguous"),
      kind: "locatorAmbiguous",
      message: "two matches",
      tapePath: join(outDir, "replay.log"),
      stepIndex: 4,
      widgetRef: "page.cancel",
    });
    assert.deepEqual(findingFolders(outDir), [
      findingId(1, "httpError"),
      findingId(2, "httpError"),
      findingId(3, "locatorAmbiguous"),
      findingId(4, "locatorAmbiguous"),
    ]);
  });

  it("does not persist unknownId or unresolvedId folders", () => {
    assert.equal(shouldPersistFinding("unknownId"), false);
    assert.equal(shouldPersistFinding("unresolvedId"), false);
    assert.equal(shouldPersistFinding("expectFailed"), true);
    const outDir = mkdtempSync(join(tmpdir(), "cm-fnd-miss-"));
    const missed = persistFinding(outDir, {
      schemaVersion: 1,
      id: findingId(1, "unknownId"),
      kind: "unknownId",
      message: "unknown id missing_page",
      tapePath: join(outDir, "replay.log"),
      stepIndex: 1,
    });
    const unresolved = persistFinding(outDir, {
      schemaVersion: 1,
      id: findingId(2, "unresolvedId"),
      kind: "unresolvedId",
      message: "unresolved id page.gone",
      tapePath: join(outDir, "replay.log"),
      stepIndex: 2,
    });
    assert.equal(missed.created, false);
    assert.equal(unresolved.created, false);
    assert.deepEqual(findingFolders(outDir), []);
    assert.equal(existsSync(join(outDir, "findings")), false);
  });
});
