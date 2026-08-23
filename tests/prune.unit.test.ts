import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { appendDismissed, isDismissed, loadDismissed } from "../src/persist/dismissed.js";
import { saveConfig } from "../src/persist/config.js";
import { writeReportFolder } from "../src/persist/reports.js";
import { collectFindingCases } from "../src/persist/runs.js";
import { emptyConfig } from "../src/schema/config.js";
import { findingId } from "../src/schema/finding.js";
import {
  findingFingerprint,
  renderFindingsReport,
  writeRunsReport,
} from "../src/reports/findings-report.js";
import { dropReportFindings, parseReportFindings, suggestFalsePositives } from "../src/reports/prune.js";

function writeFinding(runDir: string, id: string, kind: "expectFailed" | "visualIssue", message: string) {
  const folder = join(runDir, "findings", id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "finding.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      id,
      kind,
      message,
      tapePath: join(folder, "replay.log"),
      stepIndex: 1,
    })}\n`,
  );
  writeFileSync(join(folder, "replay.log"), "open home\n");
}

describe("prune report findings", () => {
  it("parses finding cards and drops one without touching Quality", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-prune-"));
    const runDir = join(root, "runs", "sess-a");
    writeFinding(runDir, findingId(3, "expectFailed"), "expectFailed", "expected invalid, field is valid");
    writeFinding(runDir, findingId(4, "visualIssue"), "visualIssue", "scanline: row icons drift");
    const cases = collectFindingCases([runDir], { tapes: false });
    const md = renderFindingsReport(
      cases,
      {
        url: "http://127.0.0.1:4173/",
        generatedAt: "t",
        runIds: ["sess-a"],
        quality: {
          schemaVersion: 1,
          pages: [
            {
              path: "/",
              foundAt: "t",
              html: [{ source: "html", rule: "no-dup-id", severity: "error", message: "dup", count: 1 }],
              a11y: [],
              visual: [],
              runtime: [],
            },
          ],
        },
      },
      join(root, "findings.md"),
    );
    const parsed = parseReportFindings(md);
    assert.equal(parsed.length, 2);
    assert.ok(parsed.some((f) => f.id === findingId(3, "expectFailed")));
    assert.ok(parsed.some((f) => f.kind === "visualIssue"));
    const { markdown, dropped, kept } = dropReportFindings(md, [findingId(4, "visualIssue")]);
    assert.equal(dropped.length, 1);
    assert.equal(dropped[0]?.kind, "visualIssue");
    assert.equal(kept.length, 1);
    assert.match(markdown, /fnd_3_expectFailed/);
    assert.doesNotMatch(markdown, /fnd_4_visualIssue/);
    assert.match(markdown, /1 finding from 1 run/);
    assert.match(markdown, /## Quality/);
    assert.match(markdown, /no-dup-id/);
    assert.equal(parseReportFindings(markdown).length, 1);
  });

  it("drops only the selected run when two cards share an fnd_ id", () => {
    const md = `# Findings report

## Summary

2 findings from 2 runs (2 major).

## Findings

## Major

### expected invalid A

\`expectFailed\` · major · \`fnd_3_expectFailed\` · \`run-a\` · \`home\`

why a

### expected invalid B

\`expectFailed\` · major · \`fnd_3_expectFailed\` · \`run-b\` · \`home\`

why b

## Appendix

done
`;
    const parsed = parseReportFindings(md);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0]?.key, "run-a/fnd_3_expectFailed");
    assert.equal(parsed[1]?.key, "run-b/fnd_3_expectFailed");
    const { markdown, dropped, kept } = dropReportFindings(md, ["run-a/fnd_3_expectFailed"]);
    assert.equal(dropped.length, 1);
    assert.equal(kept.length, 1);
    assert.equal(kept[0]?.key, "run-b/fnd_3_expectFailed");
    assert.match(markdown, /expected invalid B/);
    assert.doesNotMatch(markdown, /expected invalid A/);
    const both = dropReportFindings(md, ["fnd_3_expectFailed"]);
    assert.equal(both.dropped.length, 0, "bare colliding id must not drop both cards");
  });

  it("clears the findings section when every card is dropped", () => {
    const md = `# Findings report

## Summary

1 finding from 1 run (1 major).

- **url:** http://127.0.0.1:4173/
- **runs:** sess-a

## Findings

## Major

### expected invalid

\`expectFailed\` · major · \`fnd_3_expectFailed\` · \`sess-a\`

why

## Quality

### Chrome

- leftover
`;
    const { markdown, kept } = dropReportFindings(md, ["fnd_3_expectFailed"]);
    assert.equal(kept.length, 0);
    assert.match(markdown, /0 findings from 1 run \(none\)/);
    assert.match(markdown, /_No findings in the selected runs\._/);
    assert.match(markdown, /## Quality/);
    assert.doesNotMatch(markdown, /### expected invalid/);
  });

  it("suggestFalsePositives keeps only known ids", async () => {
    const findings = [
      {
        id: "fnd_1_uiIssue",
        ids: ["fnd_1_uiIssue"],
        runIds: ["r"],
        key: "r/fnd_1_uiIssue",
        kind: "uiIssue",
        severity: "suggestion",
        title: "overlap",
        heading: "## Suggestion",
        markdown: "### overlap\n",
      },
    ];
    const suggested = await suggestFalsePositives(
      findings,
      "## Findings\n\n### overlap\n\n`uiIssue` · suggestion · `fnd_1_uiIssue`\n",
      {
        url: "http://127.0.0.1:4173/",
        intro: [],
        writePolicy: "validationOnly",
        map: { schemaVersion: 1, app: "x", generation: 0, pages: [] },
        brain: { baseUrl: "http://127.0.0.1:9", model: "mock" },
      },
      async () =>
        JSON.stringify({
          drop: [
            { id: "fnd_1_uiIssue", reason: "walker screenshot note" },
            { id: "fnd_99_nope", reason: "invented" },
          ],
        }),
    );
    assert.equal(suggested.get("r/fnd_1_uiIssue"), "walker screenshot note");
    assert.equal(suggested.has("fnd_99_nope"), false);
  });
});

describe("dismissed ledger", () => {
  it("skips a dismissed fingerprint on the next report", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-dismiss-"));
    const cfg = join(dir, "clickmonkey.json");
    saveConfig(cfg, emptyConfig("http://127.0.0.1:4173/"));
    const runDir = join(dir, "clickmonkey", "runs", "20260817T000000Z-abcd");
    writeFinding(runDir, findingId(3, "expectFailed"), "expectFailed", "expected invalid, field is valid");
    const cases = collectFindingCases([runDir], { tapes: false });
    assert.equal(cases.length, 1);
    const fp = findingFingerprint(cases[0]!);
    appendDismissed(cfg, [
      {
        dismissedAt: "t",
        id: cases[0]!.id,
        fingerprint: fp,
        kind: "expectFailed",
      },
    ]);
    const ledger = loadDismissed(cfg);
    assert.equal(isDismissed(ledger, { id: "other", fingerprint: fp }), true);
    assert.equal(isDismissed(ledger, { id: cases[0]!.id }), false);
    const written = await writeRunsReport({
      configPath: cfg,
      config: emptyConfig("http://127.0.0.1:4173/"),
      runDirs: [runDir],
    });
    assert.equal(written.caseCount, 0);
    assert.equal(written.findingCount, 0);
    assert.match(written.mdPath, /findings.md$/);
  });
});

describe("clickmonkey prune", () => {
  it("drops --ids from a report folder without a TTY", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-prune-cli-"));
    const cfg = join(dir, "clickmonkey.json");
    saveConfig(cfg, emptyConfig("http://127.0.0.1:4173/"));
    const runDir = join(dir, "clickmonkey", "runs", "20260817T000000Z-abcd");
    writeFinding(runDir, findingId(3, "expectFailed"), "expectFailed", "expected invalid, field is valid");
    writeFinding(runDir, findingId(4, "visualIssue"), "visualIssue", "scanline: row icons drift");
    const cases = collectFindingCases([runDir], { tapes: false });
    const reportId = "20260817T010000Z-prune";
    const mdPath = join(dir, "clickmonkey", "reports", reportId, "findings.md");
    const markdown = renderFindingsReport(
      cases,
      { url: "http://127.0.0.1:4173/", generatedAt: "t", runIds: ["20260817T000000Z-abcd"] },
      mdPath,
    );
    writeReportFolder(cfg, {
      id: reportId,
      url: "http://127.0.0.1:4173/",
      generatedAt: "t",
      runIds: ["20260817T000000Z-abcd"],
      findingCount: 2,
      markdown,
    });
    const cli = fileURLToPath(new URL("../src/cli/index.ts", import.meta.url));
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", cli, "prune", reportId, "--config", cfg, "--ids", findingId(4, "visualIssue")],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const next = readFileSync(mdPath, "utf8");
    assert.match(next, /fnd_3_expectFailed/);
    assert.doesNotMatch(next, /fnd_4_visualIssue/);
    assert.match(result.stderr, /dropped 1 finding/);
    const ledger = loadDismissed(cfg);
    assert.equal(
      isDismissed(ledger, { id: findingId(4, "visualIssue"), runId: "20260817T000000Z-abcd" }),
      true,
    );
  });
});
