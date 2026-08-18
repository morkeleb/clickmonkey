import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { collectFindingCases } from "../src/persist/runs.js";
import { extractClickmonkeyFences } from "../src/reports/fences.js";
import { caseKey, enrichWithBrain, isChromeRow, renderFindingsReport } from "../src/reports/findings-report.js";
import { findingId } from "../src/schema/finding.js";

describe("findings report", () => {
  it("renders severity groups, screenshot links, and clickmonkey fences", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-rep-"));
    const runDir = join(root, "runs", "20260817T000000Z-abcd");
    const folder = join(runDir, "findings", "fnd_3_expectFailed");
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "finding.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        id: findingId(3, "expectFailed"),
        kind: "expectFailed",
        severity: "major",
        message: "expected invalid, field is valid",
        tapePath: join(folder, "replay.log"),
        stepIndex: 3,
      })}\n`,
    );
    writeFileSync(join(folder, "report.md"), "Expected validation / expect failed.\n");
    writeFileSync(join(folder, "replay.log"), "open home\nfill create.name \"\"\nclick create.submit\nexpect create.name invalid\n");
    writeFileSync(join(folder, "screenshot.png"), "png");

    const cases = collectFindingCases([runDir]);
    assert.equal(cases.length, 1);
    const out = join(root, "findings.md");
    const md = renderFindingsReport(
      cases,
      {
        url: "http://127.0.0.1:4173/",
        generatedAt: "2026-08-17T00:00:00.000Z",
        runIds: ["20260817T000000Z-abcd"],
      },
      out,
    );
    assert.match(md, /^# Findings report/m);
    assert.match(md, /^## Summary/m);
    assert.match(md, /^## Major/m);
    assert.match(md, /!\[screenshot\]\(runs\/20260817T000000Z-abcd\/findings\/fnd_3_expectFailed\/screenshot\.png\)/);
    assert.match(md, /```clickmonkey/);
    assert.match(md, /^## Findings/m);
    const findingsAt = md.indexOf("## Findings");
    const qualityAt = md.indexOf("## Quality");
    assert.ok(qualityAt === -1 || findingsAt < qualityAt, "findings before quality");
    const fences = extractClickmonkeyFences(md);
    assert.equal(fences.length, 1);
    assert.equal(fences[0]?.log.steps.some((s) => s.kind === "expectInvalid"), true);
  });

  it("rolls quality into unique rules and omits preload noise", () => {
    const md = renderFindingsReport(
      [],
      {
        url: "http://127.0.0.1:4173/",
        generatedAt: "t",
        runIds: [],
        quality: {
          schemaVersion: 1,
          pages: [
            {
              path: "/",
              foundAt: "t",
              html: [{ source: "html", rule: "no-multiple-main", severity: "error", message: "dup main", count: 1 }],
              a11y: [],
              runtime: [
                {
                  source: "console",
                  rule: "console.warning",
                  severity: "warning",
                  message: "The resource /font.woff2 was preloaded but not used within a few seconds",
                  count: 7,
                  firstSeen: "t",
                  lastSeen: "t",
                },
                {
                  source: "pageError",
                  rule: "pageError",
                  severity: "error",
                  message: "Ga(...) is not a function",
                  count: 1,
                  firstSeen: "t",
                  lastSeen: "t",
                },
              ],
            },
            {
              path: "/vendors",
              foundAt: "t",
              html: [{ source: "html", rule: "no-multiple-main", severity: "error", message: "dup main", count: 1 }],
              a11y: [],
              runtime: [],
            },
          ],
        },
      },
      "/tmp/findings.md",
    );
    assert.match(md, /### Chrome/);
    assert.match(md, /Pages with the most issues/);
    assert.match(md, /2 pages/);
    assert.match(md, /no-multiple-main/);
    assert.match(md, /Ga\(\.\.\.\) is not a function/);
    assert.match(md, /`\/` — 1 error, 0 warnings/);
    assert.match(md, / {2}- `pageError` error — Ga\(\.\.\.\) is not a function/);
    assert.doesNotMatch(md, / {2}- `no-multiple-main`/);
    assert.doesNotMatch(md, /`\/vendors` —/);
    assert.doesNotMatch(md, /Recurring rules/);
    assert.doesNotMatch(md, /preloaded but not used/);
    assert.doesNotMatch(md, /### `\/` —/);
  });

  it("treats majority and large-walk thirds as chrome", () => {
    assert.equal(isChromeRow({ pages: 2 }, 2), true);
    assert.equal(isChromeRow({ pages: 1 }, 2), false);
    assert.equal(isChromeRow({ pages: 1 }, 1), false);
    assert.equal(isChromeRow({ pages: 24 }, 62), true);
    assert.equal(isChromeRow({ pages: 15 }, 62), false);
    assert.equal(isChromeRow({ pages: 3 }, 8), true);
    assert.equal(isChromeRow({ pages: 2 }, 8), false);
  });

  it("enrichWithBrain keeps only known ids", async () => {
    const extras = await enrichWithBrain(
      [
        {
          id: "fnd_1_uiIssue",
          runId: "r",
          runDir: "/tmp",
          finding: {
            schemaVersion: 1,
            id: "fnd_1_uiIssue",
            kind: "uiIssue",
            message: "overlap",
            tapePath: "/tmp/x",
            stepIndex: 1,
          },
          severity: "suggestion",
          title: "overlap",
          description: "overlap",
          tape: "screenshot ui overlap\n",
        },
      ],
      {
        url: "http://127.0.0.1:4173/",
        intro: [],
        writePolicy: "validationOnly",
        map: { schemaVersion: 1, app: "x", generation: 0, pages: [] },
        brain: { baseUrl: "http://127.0.0.1:9", model: "mock" },
      },
      async () =>
        JSON.stringify({
          summary: "One UI overlap.",
          items: [
            { id: "r/fnd_1_uiIssue", title: "Create – buttons overlap", why: "Users miss the submit." },
            { id: "invented", title: "nope" },
          ],
        }),
    );
    assert.equal(extras.summary, "One UI overlap.");
    assert.equal(extras.extras.get("r/fnd_1_uiIssue")?.title, "Create – buttons overlap");
    assert.equal(extras.extras.has("invented"), false);
  });

  it("keeps LLM extras distinct when two runs share a finding id", async () => {
    const a = {
      id: "fnd_3_expectFailed",
      runId: "sess-a",
      runDir: "/tmp/a",
      finding: {
        schemaVersion: 1 as const,
        id: "fnd_3_expectFailed",
        kind: "expectFailed" as const,
        message: "empty on a",
        tapePath: "/tmp/a",
        stepIndex: 3,
      },
      severity: "major" as const,
      title: "empty on a",
      description: "a",
      tape: "open home\n",
    };
    const b = { ...a, runId: "sess-b", runDir: "/tmp/b", finding: { ...a.finding, message: "empty on b" }, title: "empty on b", description: "b" };
    const extras = await enrichWithBrain(
      [a, b],
      {
        url: "http://127.0.0.1:4173/",
        intro: [],
        writePolicy: "validationOnly",
        map: { schemaVersion: 1, app: "x", generation: 0, pages: [] },
        brain: { baseUrl: "http://127.0.0.1:9", model: "mock" },
      },
      async () =>
        JSON.stringify({
          summary: "Two empties.",
          items: [
            { id: caseKey(a), title: "A – empty name" },
            { id: caseKey(b), title: "B – empty name" },
          ],
        }),
    );
    const md = renderFindingsReport([a, b], { url: "http://127.0.0.1:4173/", generatedAt: "t", runIds: ["sess-a", "sess-b"] }, "/tmp/findings.md", extras.extras);
    assert.match(md, /A – empty name/);
    assert.match(md, /B – empty name/);
    assert.notEqual(extras.extras.get(caseKey(a))?.title, extras.extras.get(caseKey(b))?.title);
  });
});
