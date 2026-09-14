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
  findingIdentity,
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
    assert.ok(parsed.every((f) => f.idempotencyKey && /^ik_[0-9a-f]{16}$/.test(f.idempotencyKey)));
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

  it("parses ik_ on the loc line and drops the card by that key", () => {
    const md = `# Findings report

## Summary

1 finding from 1 run (1 major).

## Findings

## Major

### expected invalid

\`expectFailed\` · major · \`ik_0123456789abcdef\` · \`fnd_3_expectFailed\` · \`sess-a\` · \`home\`

why

## Appendix

done
`;
    const parsed = parseReportFindings(md);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.id, "fnd_3_expectFailed");
    assert.equal(parsed[0]?.idempotencyKey, "ik_0123456789abcdef");
    assert.equal(parsed[0]?.runIds[0], "sess-a");
    const { markdown, dropped, kept } = dropReportFindings(md, ["ik_0123456789abcdef"]);
    assert.equal(dropped.length, 1);
    assert.equal(kept.length, 0);
    assert.doesNotMatch(markdown, /fnd_3_expectFailed/);
    assert.doesNotMatch(markdown, /ik_0123456789abcdef/);
  });

  it("keeps the Fixed section when dropping an open finding", () => {
    const md = `# Findings report

## Summary

1 finding from 2 runs (1 major). 1 fixed after a later land on the same page.

## Findings

## Major

### expected invalid

\`expectFailed\` · major · \`ik_0123456789abcdef\` · \`fnd_3_expectFailed\` · \`run-a\` · \`home\`

## Fixed

_1 finding did not reproduce when the same tape was replayed (same fills). A later unleash/nasty land is not a retest._

### scanline drift

\`visualIssue\` · minor · \`ik_fedcba9876543210\` · last \`run-a\` · retest \`run-b\` · \`home\`

## Quality

leftover
`;
    const { markdown, dropped, kept } = dropReportFindings(md, ["ik_0123456789abcdef"]);
    assert.equal(dropped.length, 1);
    assert.equal(kept.length, 0);
    assert.match(markdown, /## Fixed/);
    assert.match(markdown, /scanline drift/);
    assert.match(markdown, /## Quality/);
    assert.match(markdown, /1 fixed after a later land on the same page/);
  });

  it("parses a loc line after the tape when Accessibility follows Findings", () => {
    const md = `# Findings report

## Summary

1 finding from 1 run (1 major).

## Findings

## Major

### expected invalid

[/home](http://127.0.0.1/home) · major

**Expected:** The field is marked invalid.

**Actual:** The form sent.

**Why it matters:** Bad data.

\`\`\`clickmonkey
open home
\`\`\`

\`expectFailed\` · major · \`fnd_3_expectFailed\` · \`sess-a\` · \`home\`

## Accessibility

Checked: WCAG 2.0/2.1 A and AA (axe subset).

## Appendix

done
`;
    const parsed = parseReportFindings(md);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.id, "fnd_3_expectFailed");
    assert.equal(parsed[0]?.kind, "expectFailed");
    assert.equal(parsed[0]?.runIds[0], "sess-a");
    const { markdown, dropped, kept } = dropReportFindings(md, ["fnd_3_expectFailed"]);
    assert.equal(dropped.length, 1);
    assert.equal(kept.length, 0);
    assert.match(markdown, /## Accessibility/);
    assert.doesNotMatch(markdown, /fnd_3_expectFailed/);
  });

  it("keeps leftover-cap text when dropping a finding", () => {
    const md = `# Findings report

## Summary

2 findings from 2 runs (2 major). Showing the top 8 of 12 pages with issues. Workspace ledger across 40 pages.

## Findings

## Major

### a

\`expectFailed\` · major · 2× in 2 runs · \`fnd_3_expectFailed\` · \`run-a\` \`run-b\` · \`home\`

### b

\`visualIssue\` · minor · \`fnd_4_visualIssue\` · \`run-a\`

## Quality

leftover
`;
    const parsed = parseReportFindings(md);
    assert.equal(parsed.length, 2);
    assert.deepEqual(parsed[0]?.runIds, ["run-a", "run-b"]);
    const { markdown } = dropReportFindings(md, ["fnd_4_visualIssue"]);
    assert.match(markdown, /1 finding from 2 runs \(1 major\)\. Showing the top 8 of 12 pages with issues\. Workspace ledger across 40 pages\./);
    assert.match(markdown, /## Quality/);
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
        id: "fnd_1_visualIssue",
        ids: ["fnd_1_visualIssue"],
        runIds: ["r"],
        key: "r/fnd_1_visualIssue",
        kind: "visualIssue",
        severity: "suggestion",
        title: "overlap",
        heading: "## Suggestion",
        markdown: "### overlap\n",
      },
    ];
    const suggested = await suggestFalsePositives(
      findings,
      "## Findings\n\n### overlap\n\n`visualIssue` · suggestion · `fnd_1_visualIssue`\n",
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
            { id: "fnd_1_visualIssue", reason: "walker screenshot note" },
            { id: "fnd_99_nope", reason: "invented" },
          ],
        }),
    );
    assert.equal(suggested.get("r/fnd_1_visualIssue"), "walker screenshot note");
    assert.equal(suggested.has("fnd_99_nope"), false);
  });

  it("suggestFalsePositives accepts an ik_ id", async () => {
    const findings = [
      {
        id: "fnd_1_visualIssue",
        ids: ["fnd_1_visualIssue"],
        runIds: ["r"],
        key: "r/fnd_1_visualIssue",
        kind: "visualIssue",
        severity: "suggestion",
        title: "overlap",
        heading: "## Suggestion",
        markdown: "### overlap\n",
        idempotencyKey: "ik_0123456789abcdef",
      },
    ];
    const suggested = await suggestFalsePositives(
      findings,
      "## Findings\n\n### overlap\n\n`visualIssue` · suggestion · `ik_0123456789abcdef` · `fnd_1_visualIssue`\n",
      {
        url: "http://127.0.0.1:4173/",
        intro: [],
        writePolicy: "validationOnly",
        map: { schemaVersion: 1, app: "x", generation: 0, pages: [] },
        brain: { baseUrl: "http://127.0.0.1:9", model: "mock" },
      },
      async () => JSON.stringify({ drop: [{ id: "ik_0123456789abcdef", reason: "chrome overlap" }] }),
    );
    assert.equal(suggested.get("r/fnd_1_visualIssue"), "chrome overlap");
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
    assert.equal(isDismissed(ledger, { id: "other", idempotencyKey: findingIdentity(cases[0]!).idempotencyKey }), true);
    const written = await writeRunsReport({
      configPath: cfg,
      config: emptyConfig("http://127.0.0.1:4173/"),
      runDirs: [runDir],
    });
    assert.equal(written.caseCount, 0);
    assert.equal(written.findingCount, 0);
    assert.match(written.mdPath, /findings.md$/);
  });

  it("skips a later run of the same bug by idempotency key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-dismiss-ik-"));
    const cfg = join(dir, "clickmonkey.json");
    saveConfig(cfg, emptyConfig("http://127.0.0.1:4173/"));
    const runA = join(dir, "clickmonkey", "runs", "run-a");
    const runB = join(dir, "clickmonkey", "runs", "run-b");
    writeFinding(runA, findingId(3, "expectFailed"), "expectFailed", "expected invalid, field is valid");
    writeFinding(runB, findingId(9, "expectFailed"), "expectFailed", "expected invalid, field is valid");
    const first = collectFindingCases([runA], { tapes: false })[0]!;
    const ik = findingIdentity(first).idempotencyKey;
    appendDismissed(cfg, [{ dismissedAt: "t", id: first.id, idempotencyKey: ik, kind: "expectFailed" }]);
    const later = collectFindingCases([runB], { tapes: false })[0]!;
    assert.notEqual(later.id, first.id);
    assert.equal(findingIdentity(later).idempotencyKey, ik);
    const written = await writeRunsReport({
      configPath: cfg,
      config: emptyConfig("http://127.0.0.1:4173/"),
      runDirs: [runB],
    });
    assert.equal(written.caseCount, 0);
    assert.equal(written.findingCount, 0);
  });

  it("does not append an ik_ that already matches a stored fingerprint", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-dismiss-dedup-"));
    const cfg = join(dir, "clickmonkey.json");
    saveConfig(cfg, emptyConfig("http://127.0.0.1:4173/"));
    const runDir = join(dir, "clickmonkey", "runs", "run-a");
    writeFinding(runDir, findingId(3, "expectFailed"), "expectFailed", "expected invalid, field is valid");
    const c = collectFindingCases([runDir], { tapes: false })[0]!;
    const ident = findingIdentity(c);
    appendDismissed(cfg, [{ dismissedAt: "t", id: c.id, fingerprint: ident.fingerprint, kind: "expectFailed" }]);
    appendDismissed(cfg, [{ dismissedAt: "t", id: "fnd_9_expectFailed", idempotencyKey: ident.idempotencyKey }]);
    assert.equal(loadDismissed(cfg).items.length, 1);
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
    assert.equal(ledger.items.length, 1);
    assert.match(ledger.items[0]?.idempotencyKey ?? "", /^ik_[0-9a-f]{16}$/);
  });

  it("prune --ids ik_ writes one dismissed item that covers a later fnd_ id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-prune-ik-"));
    const cfg = join(dir, "clickmonkey.json");
    saveConfig(cfg, emptyConfig("http://127.0.0.1:4173/"));
    const runA = join(dir, "clickmonkey", "runs", "run-a");
    const runB = join(dir, "clickmonkey", "runs", "run-b");
    writeFinding(runA, findingId(4, "visualIssue"), "visualIssue", "scanline: row icons drift");
    writeFinding(runB, findingId(4, "visualIssue"), "visualIssue", "scanline: row icons drift");
    const cases = collectFindingCases([runA, runB], { tapes: false });
    const ik = findingIdentity(cases[0]!).idempotencyKey;
    const reportId = "20260817T010000Z-prune-ik";
    const mdPath = join(dir, "clickmonkey", "reports", reportId, "findings.md");
    const markdown = renderFindingsReport(
      cases,
      { url: "http://127.0.0.1:4173/", generatedAt: "t", runIds: ["run-a", "run-b"] },
      mdPath,
    );
    writeReportFolder(cfg, {
      id: reportId,
      url: "http://127.0.0.1:4173/",
      generatedAt: "t",
      runIds: ["run-a", "run-b"],
      findingCount: 1,
      markdown,
    });
    const cli = fileURLToPath(new URL("../src/cli/index.ts", import.meta.url));
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", cli, "prune", reportId, "--config", cfg, "--ids", ik],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /dropped 1 finding/);
    const ledger = loadDismissed(cfg);
    assert.equal(ledger.items.length, 1);
    assert.equal(ledger.items[0]?.idempotencyKey, ik);
    const runC = join(dir, "clickmonkey", "runs", "run-c");
    writeFinding(runC, findingId(11, "visualIssue"), "visualIssue", "scanline: row icons drift");
    const written = await writeRunsReport({
      configPath: cfg,
      config: emptyConfig("http://127.0.0.1:4173/"),
      runDirs: [runC],
    });
    assert.equal(written.caseCount, 0);
    assert.equal(written.findingCount, 0);
  });
});
