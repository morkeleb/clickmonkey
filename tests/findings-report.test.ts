import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { collectFindingCases } from "../src/persist/runs.js";
import { extractClickmonkeyFences } from "../src/reports/fences.js";
import { caseKey, enrichWithBrain, renderFindingsReport } from "../src/reports/findings-report.js";
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
    const fences = extractClickmonkeyFences(md);
    assert.equal(fences.length, 1);
    assert.equal(fences[0]?.log.steps.some((s) => s.kind === "expectInvalid"), true);
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
