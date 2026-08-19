import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  countFindingsInMarkdown,
  LEGACY_REPORT_ID,
  listReports,
  readReport,
  reportTitle,
  writeReportFolder,
} from "../src/persist/reports.js";
import { saveConfig } from "../src/persist/config.js";
import { emptyConfig } from "../src/schema/config.js";

describe("reports folder", () => {
  it("writes a folder with report.json and lists it with a legacy findings.md", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-reports-"));
    const cfg = join(dir, "clickmonkey.json");
    saveConfig(cfg, emptyConfig("http://127.0.0.1:4173/"));
    const written = writeReportFolder(cfg, {
      url: "http://127.0.0.1:4173/",
      generatedAt: "2026-08-18T21:00:00.000Z",
      runIds: ["20260818T200038Z-764b", "20260818T200028Z-decb"],
      findingCount: 3,
      markdown: "# Findings report\n\n- **runs:** a, b\n",
    });
    assert.match(written.mdPath, /reports\//);
    assert.equal(written.meta.findingCount, 3);
    assert.equal(written.meta.title, "3 findings · 2 runs");
    writeFileSync(join(dir, "clickmonkey", "findings.md"), "# old\n- **runs:** sess-a\n");
    const listed = listReports(cfg);
    assert.ok(listed.some((r) => r.id === written.id));
    assert.ok(listed.some((r) => r.id === LEGACY_REPORT_ID && r.runIds.includes("sess-a")));
    const loaded = readReport(cfg, written.id);
    assert.ok(loaded?.markdown.includes("# Findings report"));
  });

  it("lists a folder from report.json without needing markdown extras", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-reports-meta-"));
    const cfg = join(dir, "clickmonkey.json");
    saveConfig(cfg, emptyConfig("http://127.0.0.1:4173/"));
    writeReportFolder(cfg, {
      id: "20260818T210000Z-aaaa",
      url: "http://127.0.0.1:4173/",
      generatedAt: "2026-08-18T21:00:00.000Z",
      runIds: ["sess-a"],
      findingCount: 1,
      markdown: "# Findings report\n".repeat(20),
    });
    const listed = listReports(cfg);
    assert.equal(listed[0]?.id, "20260818T210000Z-aaaa");
    assert.equal(listed[0]?.findingCount, 1);
    assert.equal(listed[0]?.title, "1 finding · sess-a");
  });

  it("names a single-run report after that run", () => {
    assert.equal(reportTitle(["sess-a"], 1), "1 finding · sess-a");
  });

  it("counts findings without Quality ### headings", () => {
    const md = `# Findings report

## Findings

## Critical

### Ga(...) is not a function

- **id:** fnd_115_pageError

## Quality

### Chrome

- \`nested-interactive\` error

### Pages with unique issues

- \`/\` — 1 error
`;
    assert.equal(countFindingsInMarkdown(md), 1);
  });
});
