import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { saveConfig } from "../src/persist/config.js";
import { persistFinding } from "../src/persist/finding.js";
import { exploreOutlineOf, setPresenceOutline, startPresence } from "../src/persist/presence.js";
import { emptyConfig } from "../src/schema/config.js";
import { buildRunDetail, stepsFromNavLog } from "../src/ui/run-detail.js";

describe("stepsFromNavLog", () => {
  it("merges step, hops, and stepDone and keeps a boot prelude", () => {
    const parsed = stepsFromNavLog(
      [
        JSON.stringify({
          ts: "2026-08-18T18:00:00.000Z",
          type: "nav",
          from: "about:blank",
          to: "https://app.example/login",
          via: "document",
          status: 200,
        }),
        JSON.stringify({
          ts: "2026-08-18T18:00:01.000Z",
          type: "step",
          line: "click page.go",
          pageId: "login",
          phase: "intro",
        }),
        JSON.stringify({
          ts: "2026-08-18T18:00:01.200Z",
          type: "nav",
          from: "https://app.example/login",
          to: "https://app.example/",
          via: "commit",
        }),
        JSON.stringify({
          ts: "2026-08-18T18:00:01.400Z",
          type: "stepDone",
          line: "click page.go",
          ok: true,
          ms: 400,
        }),
        JSON.stringify({
          ts: "2026-08-18T18:00:02.000Z",
          type: "step",
          line: "click page.out",
          pageId: "home",
          phase: "walk",
        }),
        JSON.stringify({
          ts: "2026-08-18T18:00:02.100Z",
          type: "stepDone",
          line: "click page.out",
          ok: false,
          ms: 100,
          finding: "fenceViolation",
        }),
      ].join("\n"),
    );
    assert.equal(parsed.boot?.hops[0]?.to, "https://app.example/login");
    assert.equal(parsed.steps.length, 2);
    assert.equal(parsed.steps[0]?.index, 0);
    assert.equal(parsed.steps[0]?.ok, true);
    assert.equal(parsed.steps[0]?.hops?.[0]?.to, "https://app.example/");
    assert.equal(parsed.steps[1]?.finding, "fenceViolation");
    assert.equal(parsed.steps[1]?.ok, false);
  });
});

describe("buildRunDetail", () => {
  it("attaches findings and screenshot urls without leaking filesystem paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-run-detail-"));
    const path = join(dir, "clickmonkey.json");
    saveConfig(path, emptyConfig("http://127.0.0.1:4173/"));
    const runId = "20260818T180000Z-abcd";
    const runDir = join(dir, "clickmonkey", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "log.txt"), "click page.go\n");
    writeFileSync(
      join(runDir, "nav.jsonl"),
      `${JSON.stringify({
        ts: "2026-08-18T18:00:01.000Z",
        type: "step",
        line: "click page.go",
        pageId: "home",
        phase: "walk",
      })}\n${JSON.stringify({
        ts: "2026-08-18T18:00:01.200Z",
        type: "stepDone",
        line: "click page.go",
        ok: false,
        ms: 200,
        finding: "fenceViolation",
      })}\n`,
    );
    mkdirSync(join(runDir, "shots"), { recursive: true });
    writeFileSync(join(runDir, "shots", "step-000.png"), "png");
    persistFinding(
      runDir,
      {
        schemaVersion: 1,
        id: "fnd_0_fenceViolation",
        kind: "fenceViolation",
        severity: "major",
        message: "left the fence",
        tapePath: join(runDir, "replay.log"),
        stepIndex: 0,
        url: "https://idp.example/login",
      },
      { screenshotPath: join(runDir, "shots", "step-000.png") },
    );
    startPresence(runDir, { pageId: "home", brain: "explore" });
    setPresenceOutline(
      runDir,
      exploreOutlineOf({ charter: "walk the form", now: "click page.openCreate", notes: ["open create"] }),
    );

    const detail = buildRunDetail(path, runId);
    assert.ok(detail);
    assert.equal(detail.brain, "explore");
    assert.equal(detail.outline?.charter, "walk the form");
    assert.equal(detail.outline?.now, "click page.openCreate");
    assert.equal(detail.pageId, "home");
    assert.equal(detail.steps.length, 1);
    assert.equal(detail.steps[0]?.findingId, "fnd_0_fenceViolation");
    assert.equal(detail.steps[0]?.findingMessage, "left the fence");
    assert.equal(
      detail.steps[0]?.screenshotUrl,
      `/files/runs/${runId}/findings/fnd_0_fenceViolation/screenshot.png`,
    );
    assert.equal(detail.findings.length, 1);
    const json = JSON.stringify(detail);
    assert.equal(json.includes(runDir), false);
    assert.equal(json.includes("tapePath"), false);
  });
});
