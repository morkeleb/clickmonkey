import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  appendFindingReport,
  persistFinding,
  persistVisualIssueFindings,
  shouldPersistFinding,
  visualIssueMessage,
} from "../src/persist/finding.js";
import type { QualityIssue } from "../src/schema/quality.js";
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

  it("dedups a notFound on the same path even when the message differs", () => {
    const outDir = mkdtempSync(join(tmpdir(), "cm-fnd-404-"));
    const first = persistFinding(outDir, {
      schemaVersion: 1,
      id: findingId(1, "notFound"),
      kind: "notFound",
      message: "Not found page GET http://127.0.0.1:3000/applications",
      tapePath: join(outDir, "replay.log"),
      stepIndex: 1,
      url: "http://127.0.0.1:3000/applications",
    });
    const second = persistFinding(outDir, {
      schemaVersion: 1,
      id: findingId(31, "notFound"),
      kind: "notFound",
      message: "HTTP 404 GET http://127.0.0.1:3000/applications",
      tapePath: join(outDir, "replay.log"),
      stepIndex: 31,
      url: "http://127.0.0.1:3000/applications",
      httpStatus: 404,
    });
    assert.equal(second.created, false);
    assert.equal(second.finding.id, first.finding.id);
    assert.deepEqual(findingFolders(outDir), [first.finding.id]);
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

  it("files high-confidence visual issues with a screenshot and leaves the step shot", () => {
    const outDir = mkdtempSync(join(tmpdir(), "cm-fnd-vlm-"));
    const shot = join(outDir, "shots", "step-003.png");
    mkdirSync(join(outDir, "shots"), { recursive: true });
    writeFileSync(shot, "png-visual");
    const issues: QualityIssue[] = [
      {
        source: "visual",
        rule: "scanline",
        severity: "warning",
        message: "row icons drift",
        count: 1,
        confidence: "high",
        where: "row action icons",
      },
      {
        source: "visual",
        rule: "overlap",
        severity: "error",
        message: "badge covers title",
        count: 1,
        confidence: "medium",
      },
    ];
    const written = persistVisualIssueFindings(outDir, issues, {
      stepIndex: 3,
      url: "http://127.0.0.1:3000/customers/11111111-1111-4111-8111-111111111111/migrations",
      pageId: "customer_migrations",
      screenshotPath: shot,
      tapePath: join(outDir, "replay.log"),
      replayLog: "open home\n",
    });
    assert.equal(written.length, 1);
    assert.equal(written[0]?.created, true);
    assert.equal(written[0]?.finding.kind, "visualIssue");
    assert.equal(written[0]?.finding.pageId, "customer_migrations");
    assert.equal(written[0]?.finding.severity, "minor");
    assert.equal(written[0]?.finding.widgetRef, "scanline");
    assert.equal(
      written[0]?.finding.message,
      visualIssueMessage(issues[0]!),
    );
    assert.ok(existsSync(shot), "step screenshot must stay");
    const dir = join(outDir, "findings", findingId(3, "visualIssue"));
    assert.ok(existsSync(join(dir, "screenshot.png")));
    assert.match(readFileSync(join(dir, "report.md"), "utf8"), /High-confidence visual issue/);
  });

  it("dedups the same visualIssue message on a later page (chrome overlap)", () => {
    const outDir = mkdtempSync(join(tmpdir(), "cm-fnd-vlm-dedup-"));
    const issue: QualityIssue = {
      source: "visual",
      rule: "overlap",
      severity: "warning",
      message: "folder_open Clients & Matters and Your account occupy the same pixels",
      count: 1,
      confidence: "high",
      where: "folder_open Clients & Matters, Your account",
    };
    const first = persistVisualIssueFindings(outDir, [issue], {
      stepIndex: 2,
      url: "https://demo.f2dev.test/home",
      pageId: "home",
      tapePath: join(outDir, "replay.log"),
    });
    const second = persistVisualIssueFindings(outDir, [issue], {
      stepIndex: 9,
      url: "https://demo.f2dev.test/reports/cash-flow",
      pageId: "reports_cash_flow",
      tapePath: join(outDir, "replay.log"),
    });
    assert.equal(first[0]?.created, true);
    assert.equal(second[0]?.created, false);
    assert.equal(second[0]?.finding.id, first[0]?.finding.id);
    assert.deepEqual(findingFolders(outDir), [findingId(2, "visualIssue")]);
  });

  it("dedups when only the joined where suffix grew", () => {
    const outDir = mkdtempSync(join(tmpdir(), "cm-fnd-vlm-where-"));
    const base: QualityIssue = {
      source: "visual",
      rule: "overlap",
      severity: "warning",
      message: "Header or nav controls occupy the same pixels",
      count: 1,
      confidence: "high",
      where: "folder_open Clients & Matters, Your account",
    };
    const first = persistVisualIssueFindings(outDir, [base], {
      stepIndex: 1,
      url: "https://demo.f2dev.test/home",
      tapePath: join(outDir, "replay.log"),
    });
    const second = persistVisualIssueFindings(
      outDir,
      [
        {
          ...base,
          where: "folder_open Clients & Matters, Your account · group Employees expand_more, Your account",
        },
      ],
      {
        stepIndex: 8,
        url: "https://demo.f2dev.test/reports/cash-flow",
        tapePath: join(outDir, "replay.log"),
      },
    );
    assert.equal(first[0]?.created, true);
    assert.equal(second[0]?.created, false);
  });

  it("dedups 18×18 close buttons that only differ by tab name", () => {
    const outDir = mkdtempSync(join(tmpdir(), "cm-fnd-target-"));
    const issue = (where: string): QualityIssue => ({
      source: "visual",
      rule: "targetSize",
      severity: "warning",
      message: "Button is 18×18px; WCAG 2.5.8 minimum is 24×24",
      count: 1,
      confidence: "high",
      where,
    });
    const first = persistVisualIssueFindings(outDir, [issue('button "Close Action Items"')], {
      stepIndex: 2,
      url: "https://demo.f2dev.test/action-items",
      tapePath: join(outDir, "replay.log"),
    });
    const second = persistVisualIssueFindings(outDir, [issue('button "Close Trial Balance"')], {
      stepIndex: 6,
      url: "https://demo.f2dev.test/reports/trial-balance",
      tapePath: join(outDir, "replay.log"),
    });
    assert.equal(first[0]?.created, true);
    assert.equal(second[0]?.created, false);
  });

  it("keeps different overlap messages even on the same page", () => {
    const outDir = mkdtempSync(join(tmpdir(), "cm-fnd-vlm-msgs-"));
    const url = "https://demo.f2dev.test/home";
    persistVisualIssueFindings(
      outDir,
      [
        {
          source: "visual",
          rule: "overlap",
          severity: "warning",
          message: "folder_open Clients & Matters and Your account occupy the same pixels",
          count: 1,
          confidence: "high",
        },
        {
          source: "visual",
          rule: "overlap",
          severity: "warning",
          message: "dashboard Dashboard and checklist Action Items close occupy the same pixels",
          count: 1,
          confidence: "high",
        },
      ],
      { stepIndex: 4, url, tapePath: join(outDir, "replay.log") },
    );
    assert.deepEqual(findingFolders(outDir), [
      findingId(4, "visualIssue", 0),
      findingId(4, "visualIssue", 1),
    ]);
  });

  it("keeps separate visualIssue folders for different rules on the same page", () => {
    const outDir = mkdtempSync(join(tmpdir(), "cm-fnd-vlm-rules-"));
    const url = "http://127.0.0.1:3000/customers";
    persistVisualIssueFindings(
      outDir,
      [
        {
          source: "visual",
          rule: "scanline",
          severity: "warning",
          message: "row icons drift",
          count: 1,
          confidence: "high",
        },
        {
          source: "visual",
          rule: "overlap",
          severity: "error",
          message: "badge covers title",
          count: 1,
          confidence: "high",
        },
      ],
      { stepIndex: 4, url, tapePath: join(outDir, "replay.log") },
    );
    assert.deepEqual(findingFolders(outDir), [
      findingId(4, "visualIssue", 0),
      findingId(4, "visualIssue", 1),
    ]);
  });
});
