import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { saveConfig } from "../src/persist/config.js";
import { appendFixed } from "../src/persist/fixed.js";
import { findingIdentityOf } from "../src/persist/finding.js";
import { collectFindingCases, runVisits } from "../src/persist/runs.js";
import { emptyConfig } from "../src/schema/config.js";
import { findingId } from "../src/schema/finding.js";
import { classifyFindingClusters } from "../src/reports/finding-status.js";
import { writeRunsReport } from "../src/reports/findings-report.js";

function writeFinding(
  runDir: string,
  id: string,
  opts: { kind?: "expectFailed" | "visualIssue"; message: string; pageId?: string; url?: string },
) {
  const folder = join(runDir, "findings", id);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "finding.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      id,
      kind: opts.kind ?? "expectFailed",
      message: opts.message,
      tapePath: join(folder, "replay.log"),
      stepIndex: 1,
      ...(opts.pageId ? { pageId: opts.pageId } : {}),
      ...(opts.url ? { url: opts.url } : {}),
    })}\n`,
  );
  writeFileSync(join(folder, "replay.log"), "open home\n");
  writeFileSync(join(runDir, "log.txt"), "open home\n");
}

function writeLand(runDir: string, pageId: string, url: string) {
  writeFileSync(join(runDir, "log.txt"), "open home\n");
  writeFileSync(
    join(runDir, "nav.jsonl"),
    `${JSON.stringify({ ts: "t0", type: "land", url, pageId, hoppable: [] })}\n`,
  );
}

describe("runVisits", () => {
  it("collects page ids and ledger paths from land and nav events", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-visits-"));
    writeFileSync(
      join(dir, "nav.jsonl"),
      [
        JSON.stringify({ type: "land", pageId: "home", url: "http://127.0.0.1:4173/" }),
        JSON.stringify({ type: "nav", from: "http://127.0.0.1:4173/", to: "http://127.0.0.1:4173/clients/abc12345" }),
      ].join("\n"),
    );
    const visits = runVisits(dir);
    assert.equal(visits.pageIds.has("home"), true);
    assert.equal(visits.paths.has("/"), true);
    assert.equal(visits.paths.has("/clients/:id1"), true);
  });
});

describe("classifyFindingClusters", () => {
  it("does not treat a later land as a fix for a form finding", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-life-land-"));
    const runA = join(root, "20260817T000000Z-aaa1");
    const runB = join(root, "20260817T010000Z-bbb2");
    mkdirSync(runA, { recursive: true });
    mkdirSync(runB, { recursive: true });
    writeFinding(runA, findingId(3, "expectFailed"), {
      message: "expected invalid, field is valid",
      pageId: "home",
      url: "http://127.0.0.1:4173/",
    });
    writeLand(runA, "home", "http://127.0.0.1:4173/");
    writeLand(runB, "home", "http://127.0.0.1:4173/");
    const selected = collectFindingCases([runA], { tapes: false });
    const classified = classifyFindingClusters({
      selected,
      all: selected,
      selectedRunIds: ["20260817T000000Z-aaa1"],
    });
    assert.equal(classified.fixed.length, 0);
    assert.equal(classified.open.length, 1);
  });

  it("marks a bug fixed only after replay of the same tape", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-life-fixed-"));
    const runA = join(root, "20260817T000000Z-aaa1");
    mkdirSync(runA, { recursive: true });
    writeFinding(runA, findingId(3, "expectFailed"), {
      message: "expected invalid, field is valid",
      pageId: "home",
      url: "http://127.0.0.1:4173/",
    });
    writeLand(runA, "home", "http://127.0.0.1:4173/");
    const selected = collectFindingCases([runA], { tapes: false });
    const ik = findingIdentityOf(selected[0]!.finding, {
      url: selected[0]!.url,
      pageId: selected[0]!.pageId,
    }).idempotencyKey;
    const classified = classifyFindingClusters({
      selected,
      all: selected,
      selectedRunIds: ["20260817T000000Z-aaa1"],
      confirmed: {
        schemaVersion: 1,
        items: [
          {
            fixedAt: "t",
            idempotencyKey: ik,
            lastRunId: "20260817T000000Z-aaa1",
            replayId: "20260817T020000Z-rep1",
          },
        ],
      },
    });
    assert.equal(classified.open.length, 0);
    assert.equal(classified.fixed.length, 1);
    assert.equal(classified.fixed[0]?.status, "fixed");
    assert.equal(classified.fixed[0]?.retestRunId, "20260817T020000Z-rep1");
  });

  it("keeps a bug open when a later run never landed on that page", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-life-open-"));
    const runA = join(root, "20260817T000000Z-aaa1");
    const runB = join(root, "20260817T010000Z-bbb2");
    mkdirSync(runA, { recursive: true });
    mkdirSync(runB, { recursive: true });
    writeFinding(runA, findingId(3, "expectFailed"), {
      message: "expected invalid, field is valid",
      pageId: "invoices",
      url: "http://127.0.0.1:4173/invoices",
    });
    writeLand(runA, "invoices", "http://127.0.0.1:4173/invoices");
    writeLand(runB, "home", "http://127.0.0.1:4173/");
    const selected = collectFindingCases([runA], { tapes: false });
    const classified = classifyFindingClusters({
      selected,
      all: selected,
      selectedRunIds: ["20260817T000000Z-aaa1"],
    });
    assert.equal(classified.fixed.length, 0);
    assert.equal(classified.open.length, 1);
    assert.notEqual(classified.open[0]?.status, "fixed");
  });

  it("treats a first filing in the newest selected run as new", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-life-new-"));
    const runA = join(root, "20260817T000000Z-aaa1");
    mkdirSync(runA, { recursive: true });
    writeFinding(runA, findingId(3, "expectFailed"), {
      message: "expected invalid, field is valid",
      pageId: "home",
    });
    writeLand(runA, "home", "http://127.0.0.1:4173/");
    const selected = collectFindingCases([runA], { tapes: false });
    const classified = classifyFindingClusters({
      selected,
      all: selected,
      selectedRunIds: ["20260817T000000Z-aaa1"],
    });
    assert.equal(classified.open[0]?.status, "new");
  });

  it("reopens a replay-fixed bug when a later walk files the same ik_", () => {
    const root = mkdtempSync(join(tmpdir(), "cm-life-reg-"));
    const runA = join(root, "20260817T000000Z-aaa1");
    const runB = join(root, "20260817T010000Z-bbb2");
    mkdirSync(runA, { recursive: true });
    mkdirSync(runB, { recursive: true });
    const message = "expected invalid, field is valid";
    writeFinding(runA, findingId(3, "expectFailed"), { message, pageId: "home", url: "http://127.0.0.1:4173/" });
    writeFinding(runB, findingId(8, "expectFailed"), { message, pageId: "home", url: "http://127.0.0.1:4173/" });
    const all = collectFindingCases([runA, runB], { tapes: false });
    const ik = findingIdentityOf(all[0]!.finding, { url: all[0]!.url, pageId: all[0]!.pageId }).idempotencyKey;
    const classified = classifyFindingClusters({
      selected: all,
      all,
      selectedRunIds: ["20260817T000000Z-aaa1", "20260817T010000Z-bbb2"],
      confirmed: {
        schemaVersion: 1,
        items: [{ fixedAt: "t", idempotencyKey: ik, lastRunId: "20260817T000000Z-aaa1", replayId: "rep" }],
      },
    });
    assert.equal(classified.fixed.length, 0);
    assert.equal(classified.open.length, 1);
    assert.equal(classified.open[0]?.status, "still");
  });
});

describe("writeRunsReport lifecycle", () => {
  it("moves a replay-confirmed bug to Fixed and does not count it as a finding", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-rep-fixed-"));
    const cfg = join(dir, "clickmonkey.json");
    saveConfig(cfg, emptyConfig("http://127.0.0.1:4173/"));
    const runA = join(dir, "clickmonkey", "runs", "20260817T000000Z-aaa1");
    mkdirSync(runA, { recursive: true });
    writeFinding(runA, findingId(3, "expectFailed"), {
      message: "expected invalid, field is valid",
      pageId: "home",
      url: "http://127.0.0.1:4173/",
    });
    writeLand(runA, "home", "http://127.0.0.1:4173/");
    const cases = collectFindingCases([runA], { tapes: false });
    const ik = findingIdentityOf(cases[0]!.finding, { url: cases[0]!.url, pageId: cases[0]!.pageId }).idempotencyKey;
    appendFixed(cfg, [
      {
        fixedAt: "t",
        idempotencyKey: ik,
        lastRunId: "20260817T000000Z-aaa1",
        replayId: "20260817T020000Z-rep1",
      },
    ]);
    const written = await writeRunsReport({
      configPath: cfg,
      config: emptyConfig("http://127.0.0.1:4173/"),
      runDirs: [runA],
    });
    assert.equal(written.findingCount, 0);
    assert.equal(written.caseCount, 0);
    assert.equal(written.classified?.fixed.length, 1);
    const md = readFileSync(written.mdPath, "utf8");
    assert.match(md, /0 findings from 1 run/);
    assert.match(md, /1 confirmed fixed by replaying the same tape/);
    assert.match(md, /^## Fixed/m);
    assert.doesNotMatch(md.slice(md.indexOf("## Findings"), md.indexOf("## Fixed")), /### /);
  });
});
