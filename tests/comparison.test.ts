import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatReplayReport, renderComparison, type ReplayReportResult } from "../src/playbooks/replay-report.js";

function sample(status: ReplayReportResult["cases"][0]["status"]): ReplayReportResult {
  return {
    ok: status === "fixed" || status === "look",
    sourceReport: "/tmp/clickmonkey/findings.md",
    comparisonPath: "/tmp/clickmonkey/replays/x/comparison.md",
    cases: [
      {
        title: "Empty name accepted",
        ok: status === "fixed",
        status,
        caseDir: "/tmp/clickmonkey/replays/x/case-01",
        beforePath: "/tmp/clickmonkey/replays/x/case-01/before.png",
        afterPath: "/tmp/clickmonkey/replays/x/case-01/after.png",
        ...(status === "still"
          ? {
              finding: {
                schemaVersion: 1 as const,
                id: "fnd_3_expectFailed",
                kind: "expectFailed" as const,
                message: "expected invalid, field is valid",
                tapePath: "/tmp/t",
                stepIndex: 3,
              },
            }
          : {}),
      },
    ],
  };
}

describe("replay comparison", () => {
  it("writes a before/after table and a scannable summary", () => {
    const still = sample("still");
    const md = renderComparison(still);
    assert.match(md, /# Replay comparison/);
    assert.match(md, /not a new run/i);
    assert.match(md, /STILL — Empty name accepted/);
    assert.match(md, /!\[before\]\(case-01\/before\.png\)/);
    assert.match(md, /!\[after\]\(case-01\/after\.png\)/);
    const text = formatReplayReport(still);
    assert.match(text, /Compared 1 case/);
    assert.match(text, /STILL  1/);
    assert.match(text, /comparison: /);
  });

  it("marks LOOK as needing eyes, not as a machine fail", () => {
    const look = sample("look");
    assert.equal(look.ok, true);
    assert.match(renderComparison(look), /Needs human eyes/);
    assert.match(formatReplayReport(look), /LOOK/);
  });
});
