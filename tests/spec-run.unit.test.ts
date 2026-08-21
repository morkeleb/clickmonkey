import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  countHarvestedFindings,
  formatSpecResults,
  formatSpecTable,
  shouldFailOnFindings,
  specFenceIdleError,
  specStepFailed,
  surveyorErrorCount,
  surveyorShouldFail,
  type SpecRunCase,
} from "../src/playbooks/spec.js";
import { FindingKind } from "../src/schema/finding.js";
import { QualityReport } from "../src/schema/quality.js";
import { TestabilityReport } from "../src/schema/testability.js";

const cases: SpecRunCase[] = [
  {
    file: "/tmp/clickmonkey/specs/add-customer.md",
    title: "Add customer requires a name",
    ok: true,
    findingCount: 12,
  },
  {
    file: "/tmp/clickmonkey/specs/ok.md",
    title: "Home loads",
    ok: true,
    findingCount: 0,
  },
  {
    file: "/tmp/clickmonkey/specs/login.md",
    title: "Test login lands in app",
    ok: false,
    error: "expected path / , got /login",
    findingCount: 0,
  },
];

function htmlPage(severity: "error" | "warning") {
  return QualityReport.parse({
    schemaVersion: 1,
    pages: [
      {
        path: "/",
        foundAt: "2026-01-01T00:00:00.000Z",
        html: [{ source: "html", rule: "no-dup-id", severity, message: "dup", count: 1 }],
      },
    ],
  });
}

describe("formatSpecResults", () => {
  it("writes markdown with run id, fence counts, and PASS/FAIL cases", () => {
    const md = formatSpecResults({ runId: "20260820T000000Z-abcd", cases, findingErrors: 12 });
    assert.equal(
      md,
      `# Spec results

- **run:** 20260820T000000Z-abcd
- **ok:** 2/3 fences
- **findings:** 12 surveyor issues

## Cases

- PASS \`specs/add-customer.md\` — Add customer requires a name — findings 12
- PASS \`specs/ok.md\` — Home loads
- FAIL \`specs/login.md\` — Test login lands in app — expected path / , got /login
`,
    );
  });

  it("does not mention json", () => {
    const md = formatSpecResults({ runId: "r", cases, findingErrors: 0 });
    assert.doesNotMatch(md, /json/i);
  });
});

describe("formatSpecTable", () => {
  it("aligns file columns and prints a fence count summary", () => {
    const table = formatSpecTable(cases);
    assert.equal(
      table,
      `PASS  specs/add-customer.md  Add customer requires a name  (findings 12)
PASS  specs/ok.md            Home loads
FAIL  specs/login.md         Test login lands in app  expected path / , got /login
3 fences, 1 failed, 12 findings on passing cases
`,
    );
  });
});

describe("specStepFailed", () => {
  it("fails every FindingKind except uiIssue and visualIssue", () => {
    for (const kind of FindingKind.options) {
      if (kind === "uiIssue" || kind === "visualIssue") {
        assert.equal(specStepFailed(kind), false, kind);
      } else {
        assert.equal(specStepFailed(kind), true, kind);
      }
    }
    assert.equal(specStepFailed(undefined), false);
    assert.equal(specStepFailed("notAKind"), true);
  });
});

describe("specFenceIdleError", () => {
  it("fails intro-only and empty fences instead of a silent PASS", () => {
    assert.equal(specFenceIdleError(3, 0), "fence is only intro");
    assert.equal(specFenceIdleError(0, 0), "empty fence");
    assert.equal(specFenceIdleError(3, 1), undefined);
  });
});

describe("shouldFailOnFindings", () => {
  it("exits 1 only when fences passed and extras remain", () => {
    assert.equal(shouldFailOnFindings(true, 12, true), true);
    assert.equal(shouldFailOnFindings(true, 12, false), false);
    assert.equal(shouldFailOnFindings(true, 0, true), false);
    assert.equal(shouldFailOnFindings(false, 12, true), false);
  });
});

describe("countHarvestedFindings", () => {
  it("counts uiIssue/visualIssue folders and ignores blocking kinds", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-spec-harvest-"));
    const findings = join(dir, "findings");
    mkdirSync(join(findings, "fnd_1_visualIssue"), { recursive: true });
    mkdirSync(join(findings, "fnd_2_uiIssue"), { recursive: true });
    mkdirSync(join(findings, "fnd_3_expectFailed"), { recursive: true });
    writeFileSync(
      join(findings, "fnd_1_visualIssue", "finding.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        id: "fnd_1_visualIssue",
        kind: "visualIssue",
        message: "overlap",
        tapePath: "log.txt",
        stepIndex: 1,
      })}\n`,
    );
    writeFileSync(
      join(findings, "fnd_2_uiIssue", "finding.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        id: "fnd_2_uiIssue",
        kind: "uiIssue",
        message: "awkward",
        tapePath: "log.txt",
        stepIndex: 2,
      })}\n`,
    );
    writeFileSync(
      join(findings, "fnd_3_expectFailed", "finding.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        id: "fnd_3_expectFailed",
        kind: "expectFailed",
        message: "expected visible",
        tapePath: "log.txt",
        stepIndex: 3,
      })}\n`,
    );
    assert.equal(countHarvestedFindings(dir), 2);
    assert.equal(countHarvestedFindings(join(dir, "empty")), 0);
  });
});

describe("spec-results artifact", () => {
  it("runner source writes markdown only", () => {
    const src = readFileSync(new URL("../src/playbooks/spec.ts", import.meta.url), "utf8");
    assert.match(src, /spec-results\.md/);
    assert.doesNotMatch(src, /spec-results\.json/);
  });
});

describe("surveyorShouldFail", () => {
  it("is false with 0 folders and no ledger errors", () => {
    assert.equal(surveyorShouldFail({ findingFolderCount: 0 }), false);
    assert.equal(surveyorErrorCount(undefined, undefined, 0), 0);
  });

  it("is true with one html error", () => {
    const quality = htmlPage("error");
    assert.equal(surveyorShouldFail({ quality, findingFolderCount: 0 }), true);
    assert.equal(surveyorErrorCount(quality, undefined, 0), 1);
  });

  it("is false when quality rows are warnings only", () => {
    const quality = htmlPage("warning");
    assert.equal(surveyorShouldFail({ quality, findingFolderCount: 0 }), false);
    assert.equal(surveyorErrorCount(quality, undefined, 0), 0);
  });

  it("counts harvested folders and testability blocks, not warns", () => {
    const testability = TestabilityReport.parse({
      schemaVersion: 1,
      pages: [
        {
          path: "/",
          foundAt: "2026-01-01T00:00:00.000Z",
          insufficient: true,
          issues: [
            { code: "opaqueControl", severity: "block", tag: "button" },
            { code: "unlabeledField", severity: "warn", tag: "input" },
          ],
        },
      ],
    });
    assert.equal(surveyorShouldFail({ testability, findingFolderCount: 1 }), true);
    assert.equal(surveyorErrorCount(undefined, testability, 1), 2);
    assert.equal(surveyorShouldFail({ testability: { ...testability, pages: [] }, findingFolderCount: 0 }), false);
  });
});
