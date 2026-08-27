import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { saveConfig } from "../src/persist/config.js";
import { specsDir } from "../src/persist/workspace.js";
import {
  countHarvestedFindings,
  defaultSpecSkills,
  formatSpecResults,
  formatSpecTable,
  shouldFailOnFindings,
  SPEC_SKILL_FALLBACK,
  specFenceHasExpect,
  specFenceIdleError,
  specSlug,
  specStepFailed,
  surveyorErrorCount,
  surveyorShouldFail,
  writeSpecMarkdown,
  type SpecRunCase,
} from "../src/playbooks/spec.js";
import { emptyConfig } from "../src/schema/config.js";
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
  it("fails every FindingKind except visualIssue", () => {
    for (const kind of FindingKind.options) {
      if (kind === "visualIssue") {
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

describe("specFenceHasExpect", () => {
  it("requires an expect step on the replayable tape", () => {
    assert.equal(
      specFenceHasExpect([
        { kind: "open", page: "home" },
        { kind: "click", surface: "page", id: "go" },
      ]),
      false,
    );
    assert.equal(
      specFenceHasExpect([
        { kind: "open", page: "home" },
        { kind: "expectPath", path: "/" },
      ]),
      true,
    );
  });
});

describe("default spec pack", () => {
  it("teaches when to freeze, how to walk, and how to prove", () => {
    const skills = defaultSpecSkills();
    assert.match(skills, /frozen contract/);
    assert.match(skills, /spec_save/);
    assert.match(skills, /Do not invent widget ids/);
    assert.match(skills, /Do not write the fence by hand/);
    assert.match(skills, /at least one `expect`/);
    assert.match(skills, /clickmonkey:\/\/map/);
    assert.match(skills, /\$CLICKMONKEY_/);
    assert.match(skills, /expect surface.id invalid/);
    assert.match(skills, /spec_check/);
    assert.match(skills, /spec_run/);
    assert.match(skills, /Add customer requires a name/);
    assert.doesNotMatch(skills, /The host writes the markdown file/);
    assert.equal(skills.trim(), SPEC_SKILL_FALLBACK.trim());
  });
});

describe("writeSpecMarkdown", () => {
  it("writes a clickmonkey fence, strips intro, and rejects empty tapes", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-spec-write-"));
    const configPath = join(dir, "clickmonkey.json");
    saveConfig(configPath, emptyConfig("http://127.0.0.1:4173/", "fixture"));
    try {
      const written = writeSpecMarkdown({
        configPath,
        title: "Add customer requires a name",
        intro: ["click page.login"],
        log: {
          schemaVersion: 1,
          comments: [],
          steps: [
            { kind: "click", surface: "page", id: "login" },
            { kind: "open", page: "home" },
            { kind: "fill", surface: "page", id: "name", value: "" },
            { kind: "click", surface: "page", id: "save" },
            { kind: "expectInvalid", surface: "page", id: "name" },
          ],
          usedLocators: {},
        },
      });
      assert.equal(written.relative, "clickmonkey/specs/add-customer-requires-a-name.md");
      assert.equal(written.steps, 4);
      const body = readFileSync(written.path, "utf8");
      assert.match(body, /^# Add customer requires a name/m);
      assert.match(body, /```clickmonkey/);
      assert.doesNotMatch(body, /click page\.login/);
      assert.match(body, /^open home$/m);
      assert.match(body, /expect page\.name invalid/);
      assert.equal(specSlug("Add customer requires a name"), "add-customer-requires-a-name");

      assert.throws(
        () =>
          writeSpecMarkdown({
            configPath,
            title: "Wander",
            log: {
              schemaVersion: 1,
              comments: [],
              steps: [
                { kind: "open", page: "home" },
                { kind: "click", surface: "page", id: "go" },
              ],
              usedLocators: {},
            },
          }),
        /fence has no expect/,
      );
      assert.throws(
        () =>
          writeSpecMarkdown({
            configPath,
            title: "Empty",
            log: { schemaVersion: 1, comments: [], steps: [], usedLocators: {} },
          }),
        /empty fence/,
      );
      assert.throws(
        () =>
          writeSpecMarkdown({
            configPath,
            title: "Intro only",
            intro: ["click page.login"],
            log: {
              schemaVersion: 1,
              comments: [],
              steps: [{ kind: "click", surface: "page", id: "login" }],
              usedLocators: {},
            },
          }),
        /fence is only intro/,
      );
      assert.throws(
        () =>
          writeSpecMarkdown({
            configPath,
            title: "Nope",
            fileName: "../escape.md",
            log: {
              schemaVersion: 1,
              comments: [],
              steps: [
                { kind: "open", page: "home" },
                { kind: "expectPath", path: "/" },
              ],
              usedLocators: {},
            },
          }),
        /under clickmonkey\/specs/,
      );
      assert.ok(existsSync(join(specsDir(configPath), "add-customer-requires-a-name.md")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
  it("counts visualIssue folders and ignores blocking kinds", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-spec-harvest-"));
    const findings = join(dir, "findings");
    mkdirSync(join(findings, "fnd_1_visualIssue"), { recursive: true });
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
    assert.equal(countHarvestedFindings(dir), 1);
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
