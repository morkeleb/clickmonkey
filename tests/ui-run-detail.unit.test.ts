import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { saveConfig } from "../src/persist/config.js";
import { persistFinding } from "../src/persist/finding.js";
import { exploreOutlineOf, setPresenceOutline, startPresence } from "../src/persist/presence.js";
import { emptyConfig } from "../src/schema/config.js";
import {
  buildRunDetail,
  latestPageScreenshotUrls,
  shotPageId,
  shotRelsByIndex,
  stepsFromNavLog,
} from "../src/ui/run-detail.js";

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

  it("reads landing pageId from stepDone as atPageId", () => {
    const parsed = stepsFromNavLog(
      [
        JSON.stringify({ ts: "t0", type: "step", line: "click page.go", pageId: "home", phase: "walk" }),
        JSON.stringify({
          ts: "t1",
          type: "nav",
          from: "http://127.0.0.1:4173/",
          to: "http://127.0.0.1:4173/runs/abc",
          via: "commit",
        }),
        JSON.stringify({
          ts: "t2",
          type: "stepDone",
          line: "click page.go",
          ok: true,
          ms: 10,
          pageId: "schema_analysis_run",
        }),
      ].join("\n"),
    );
    assert.equal(parsed.steps[0]?.pageId, "home");
    assert.equal(parsed.steps[0]?.atPageId, "schema_analysis_run");
  });

  it("attaches a preceding brain note to the next step", () => {
    const parsed = stepsFromNavLog(
      [
        JSON.stringify({
          ts: "2026-08-19T15:55:02.000Z",
          type: "brain",
          line: 'fill page.search ""',
          note: "Empty: tried empty value in search field",
          good: "search box accepted empty",
        }),
        JSON.stringify({
          ts: "2026-08-19T15:55:02.100Z",
          type: "step",
          line: 'fill page.search ""',
          pageId: "invoices",
          phase: "walk",
        }),
        JSON.stringify({
          ts: "2026-08-19T15:55:02.200Z",
          type: "stepDone",
          line: 'fill page.search ""',
          ok: true,
          ms: 100,
        }),
      ].join("\n"),
    );
    assert.equal(parsed.steps[0]?.note, "Empty: tried empty value in search field");
    assert.equal(parsed.steps[0]?.good, "search box accepted empty");
    assert.equal(parsed.steps[0]?.line, 'fill page.search ""');
  });

  it("ignores retry brain events and does not attach a mismatched decide", () => {
    const parsed = stepsFromNavLog(
      [
        JSON.stringify({
          ts: "2026-08-19T15:55:01.000Z",
          type: "brain",
          line: 'fill page.search ""',
          note: "Empty: try search",
        }),
        JSON.stringify({
          ts: "2026-08-19T15:55:01.050Z",
          type: "brain",
          message: "brain retry: not json",
        }),
        JSON.stringify({
          ts: "2026-08-19T15:55:01.100Z",
          type: "step",
          line: 'fill page.search ""',
          pageId: "invoices",
          phase: "walk",
        }),
        JSON.stringify({
          ts: "2026-08-19T15:55:01.200Z",
          type: "stepDone",
          line: 'fill page.search ""',
          ok: true,
          ms: 100,
        }),
        JSON.stringify({
          ts: "2026-08-19T15:55:02.000Z",
          type: "brain",
          line: "open home",
          note: "Purpose: go home",
        }),
        JSON.stringify({
          ts: "2026-08-19T15:55:02.100Z",
          type: "step",
          line: "click page.save",
          pageId: "invoices",
          phase: "walk",
        }),
        JSON.stringify({
          ts: "2026-08-19T15:55:02.200Z",
          type: "stepDone",
          line: "click page.save",
          ok: true,
          ms: 100,
        }),
      ].join("\n"),
    );
    assert.equal(parsed.steps[0]?.note, "Empty: try search");
    assert.equal(parsed.steps[1]?.note, undefined);
    assert.equal(parsed.steps[1]?.line, "click page.save");
  });

  it("attaches sight from type sight events", () => {
    const pending = stepsFromNavLog(
      [
        JSON.stringify({
          ts: "2026-08-19T16:00:01.000Z",
          type: "sight",
          line: "click page.openCreate",
          sight: "Create dialog with name and amount",
        }),
        JSON.stringify({
          ts: "2026-08-19T16:00:01.100Z",
          type: "step",
          line: "click page.openCreate",
          pageId: "home",
          phase: "walk",
        }),
        JSON.stringify({
          ts: "2026-08-19T16:00:01.200Z",
          type: "stepDone",
          line: "click page.openCreate",
          ok: true,
          ms: 100,
        }),
      ].join("\n"),
    );
    assert.equal(pending.steps[0]?.sight, "Create dialog with name and amount");
    assert.equal(pending.steps[0]?.line, "click page.openCreate");

    const during = stepsFromNavLog(
      [
        JSON.stringify({
          ts: "2026-08-19T16:00:02.000Z",
          type: "step",
          line: "fill page.name \"x\"",
          pageId: "home",
          phase: "walk",
        }),
        JSON.stringify({
          ts: "2026-08-19T16:00:02.050Z",
          type: "sight",
          line: "fill page.name \"x\"",
          sight: "Name field is empty and required",
        }),
        JSON.stringify({
          ts: "2026-08-19T16:00:02.200Z",
          type: "stepDone",
          line: "fill page.name \"x\"",
          ok: true,
          ms: 200,
        }),
      ].join("\n"),
    );
    assert.equal(during.steps[0]?.sight, "Name field is empty and required");

    const afterDone = stepsFromNavLog(
      [
        JSON.stringify({
          ts: "2026-08-19T16:00:03.000Z",
          type: "step",
          line: "click page.save",
          pageId: "home",
          phase: "walk",
        }),
        JSON.stringify({
          ts: "2026-08-19T16:00:03.200Z",
          type: "stepDone",
          line: "click page.save",
          ok: true,
          ms: 200,
        }),
        JSON.stringify({
          ts: "2026-08-19T16:00:03.400Z",
          type: "sight",
          line: "click page.save",
          sight: "Save succeeded; list shows one row",
        }),
      ].join("\n"),
    );
    assert.equal(afterDone.steps[0]?.sight, "Save succeeded; list shows one row");
    assert.equal(afterDone.steps[0]?.ok, true);

    const mismatch = stepsFromNavLog(
      [
        JSON.stringify({
          ts: "2026-08-19T16:00:04.000Z",
          type: "step",
          line: "click page.save",
          pageId: "home",
          phase: "walk",
        }),
        JSON.stringify({
          ts: "2026-08-19T16:00:04.200Z",
          type: "stepDone",
          line: "click page.save",
          ok: true,
          ms: 200,
        }),
        JSON.stringify({
          ts: "2026-08-19T16:00:04.400Z",
          type: "sight",
          line: "open invoices",
          sight: "Invoice list",
        }),
        JSON.stringify({
          ts: "2026-08-19T16:00:04.500Z",
          type: "step",
          line: "click page.next",
          pageId: "home",
          phase: "walk",
        }),
        JSON.stringify({
          ts: "2026-08-19T16:00:04.600Z",
          type: "stepDone",
          line: "click page.next",
          ok: true,
          ms: 100,
        }),
      ].join("\n"),
    );
    assert.equal(mismatch.steps[0]?.sight, undefined);
    assert.equal(mismatch.steps[1]?.sight, undefined);
  });
});

describe("shotPageId", () => {
  const pages = [
    { id: "home", path: "/" },
    { id: "profile", path: "/profile" },
    { id: "schema_analysis_run", path: "/runs/abc" },
  ];
  const origin = "http://127.0.0.1:4173";

  it("uses atPageId when present", () => {
    assert.equal(shotPageId({ pageId: "home", atPageId: "schema_analysis_run" }, pages, origin), "schema_analysis_run");
  });

  it("prefers the hop URL over a stale atPageId after leaving the page", () => {
    assert.equal(
      shotPageId(
        {
          pageId: "profile",
          atPageId: "profile",
          hops: [{ from: "http://127.0.0.1:4173/profile", to: "http://127.0.0.1:4173/", via: "commit" }],
        },
        pages,
        origin,
      ),
      "home",
    );
  });

  it("keeps the start page when the step did not hop", () => {
    assert.equal(shotPageId({ pageId: "home" }, pages, origin), "home");
  });

  it("maps the last hop URL onto a map page instead of the click origin", () => {
    assert.equal(
      shotPageId(
        {
          pageId: "home",
          hops: [{ from: "http://127.0.0.1:4173/", to: "http://127.0.0.1:4173/runs/abc", via: "commit" }],
        },
        pages,
        origin,
      ),
      "schema_analysis_run",
    );
  });

  it("does not fall back to the origin page when the hop target is not on the map", () => {
    assert.equal(
      shotPageId(
        {
          pageId: "home",
          hops: [{ from: "http://127.0.0.1:4173/", to: "http://127.0.0.1:4173/missing", via: "commit" }],
        },
        pages,
        origin,
      ),
      undefined,
    );
  });

  it("does not use a notFound shot as any page's still", () => {
    assert.equal(
      shotPageId({ pageId: "home", atPageId: "home", finding: "notFound" }, pages, origin),
      undefined,
    );
  });
});

describe("latestPageScreenshotUrls", () => {
  it("fills from shots/pages when nav has no landing shot", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-page-stills-"));
    const runDir = join(dir, "20260818T190000Z-aa");
    mkdirSync(join(runDir, "shots", "pages"), { recursive: true });
    writeFileSync(join(runDir, "shots", "pages", "home.png"), "home");
    writeFileSync(join(runDir, "nav.jsonl"), "");
    const urls = latestPageScreenshotUrls([{ id: "20260818T190000Z-aa", dir: runDir }]);
    assert.equal(urls.get("home"), "/files/runs/20260818T190000Z-aa/shots/pages/home.png");
  });

  it("skips a pages still whose last visit was a notFound", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-page-stills-404-"));
    const poisoned = join(dir, "20260819T210000Z-new");
    const older = join(dir, "20260818T150000Z-old");
    mkdirSync(join(poisoned, "shots", "pages"), { recursive: true });
    mkdirSync(join(older, "shots", "pages"), { recursive: true });
    writeFileSync(join(poisoned, "shots", "pages", "home.png"), "404");
    writeFileSync(join(older, "shots", "pages", "home.png"), "dashboard");
    writeFileSync(
      join(poisoned, "nav.jsonl"),
      [
        JSON.stringify({ ts: "t0", type: "step", line: "click page.dead", pageId: "home", phase: "walk" }),
        JSON.stringify({
          ts: "t1",
          type: "stepDone",
          line: "click page.dead",
          ok: false,
          ms: 10,
          finding: "notFound",
          pageId: "home",
        }),
      ].join("\n"),
    );
    writeFileSync(join(older, "nav.jsonl"), "");
    const urls = latestPageScreenshotUrls([
      { id: "20260819T210000Z-new", dir: poisoned },
      { id: "20260818T150000Z-old", dir: older },
    ]);
    assert.equal(urls.get("home"), "/files/runs/20260818T150000Z-old/shots/pages/home.png");
  });

  it("does not keep a dashboard still on profile after hopping home", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-profile-still-"));
    const runDir = join(dir, "20260819T220000Z-aa");
    mkdirSync(join(runDir, "shots", "pages"), { recursive: true });
    writeFileSync(join(runDir, "shots", "step-000.png"), "on-profile");
    writeFileSync(join(runDir, "shots", "step-001.png"), "dashboard");
    writeFileSync(join(runDir, "shots", "pages", "profile.png"), "dashboard");
    writeFileSync(
      join(runDir, "nav.jsonl"),
      [
        JSON.stringify({ ts: "t0", type: "step", line: "click page.menuitem_profile", pageId: "home", phase: "walk" }),
        JSON.stringify({
          ts: "t1",
          type: "nav",
          from: "http://127.0.0.1:4173/",
          to: "http://127.0.0.1:4173/profile",
          via: "commit",
        }),
        JSON.stringify({
          ts: "t2",
          type: "stepDone",
          line: "click page.menuitem_profile",
          ok: true,
          ms: 10,
          pageId: "profile",
        }),
        JSON.stringify({ ts: "t3", type: "step", line: "click page.link_milkshake", pageId: "profile", phase: "walk" }),
        JSON.stringify({
          ts: "t4",
          type: "nav",
          from: "http://127.0.0.1:4173/profile",
          to: "http://127.0.0.1:4173/",
          via: "commit",
        }),
        JSON.stringify({
          ts: "t5",
          type: "stepDone",
          line: "click page.link_milkshake",
          ok: true,
          ms: 10,
          pageId: "profile",
        }),
      ].join("\n"),
    );
    const urls = latestPageScreenshotUrls([{ id: "20260819T220000Z-aa", dir: runDir }], {
      pages: [
        { id: "home", path: "/" },
        { id: "profile", path: "/profile" },
      ],
      appOrigin: "http://127.0.0.1:4173",
    });
    assert.equal(urls.get("profile"), "/files/runs/20260819T220000Z-aa/shots/step-000.png");
    assert.equal(urls.get("home"), "/files/runs/20260819T220000Z-aa/shots/step-001.png");
  });
});

describe("shotRelsByIndex", () => {
  it("indexes step-NNN.png once and prefers the exact name", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-shots-idx-"));
    mkdirSync(join(dir, "shots"));
    writeFileSync(join(dir, "shots", "step-000-hash.png"), "a");
    writeFileSync(join(dir, "shots", "step-000.png"), "b");
    writeFileSync(join(dir, "shots", "step-012.png"), "c");
    const rels = shotRelsByIndex(dir);
    assert.equal(rels.get(0), "shots/step-000.png");
    assert.equal(rels.get(12), "shots/step-012.png");
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
        finding: "expectFailed",
      })}\n`,
    );
    mkdirSync(join(runDir, "shots"), { recursive: true });
    writeFileSync(join(runDir, "shots", "step-000.png"), "png");
    persistFinding(
      runDir,
      {
        schemaVersion: 1,
        id: "fnd_0_expectFailed",
        kind: "expectFailed",
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
    assert.equal(detail.steps[0]?.findingId, "fnd_0_expectFailed");
    assert.equal(detail.steps[0]?.findingMessage, "left the fence");
    assert.equal(
      detail.steps[0]?.screenshotUrl,
      `/files/runs/${runId}/findings/fnd_0_expectFailed/screenshot.png`,
    );
    assert.equal(detail.findings.length, 1);
    assert.equal(detail.findings[0]?.pageId, "home");
    const json = JSON.stringify(detail);
    assert.equal(json.includes(runDir), false);
    assert.equal(json.includes("tapePath"), false);
  });

  it("uses the landing page when a finding.json has no pageId", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-run-detail-at-"));
    const path = join(dir, "clickmonkey.json");
    saveConfig(path, emptyConfig("http://127.0.0.1:4173/"));
    const runId = "20260818T180001Z-land";
    const runDir = join(dir, "clickmonkey", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "nav.jsonl"),
      `${JSON.stringify({ ts: "t0", type: "step", line: "click page.go", pageId: "home", phase: "walk" })}\n${JSON.stringify({
        ts: "t1",
        type: "stepDone",
        line: "click page.go",
        ok: false,
        ms: 200,
        finding: "visualIssue",
        pageId: "invoices",
      })}\n`,
    );
    persistFinding(runDir, {
      schemaVersion: 1,
      id: "fnd_0_visualIssue",
      kind: "visualIssue",
      severity: "minor",
      message: "scanline: row icons drift",
      tapePath: join(runDir, "replay.log"),
      stepIndex: 0,
    });
    const detail = buildRunDetail(path, runId);
    assert.equal(detail?.findings[0]?.pageId, "invoices");
  });

  it("keeps a persisted finding pageId and falls back to the page still", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-run-detail-page-"));
    const path = join(dir, "clickmonkey.json");
    saveConfig(path, emptyConfig("http://127.0.0.1:4173/"));
    const runId = "20260818T180002Z-page";
    const runDir = join(dir, "clickmonkey", "runs", runId);
    mkdirSync(join(runDir, "shots", "pages"), { recursive: true });
    writeFileSync(
      join(runDir, "nav.jsonl"),
      `${JSON.stringify({ ts: "t0", type: "step", line: "expect path /invoices", pageId: "home", phase: "walk" })}\n${JSON.stringify({
        ts: "t1",
        type: "stepDone",
        line: "expect path /invoices",
        ok: false,
        ms: 10,
        finding: "expectFailed",
        pageId: "home",
      })}\n`,
    );
    writeFileSync(join(runDir, "shots", "pages", "invoices.png"), "png");
    persistFinding(runDir, {
      schemaVersion: 1,
      id: "fnd_0_expectFailed",
      kind: "expectFailed",
      severity: "major",
      message: "expected invalid",
      tapePath: join(runDir, "replay.log"),
      stepIndex: 0,
      pageId: "invoices",
    });
    const detail = buildRunDetail(path, runId);
    assert.equal(detail?.findings[0]?.pageId, "invoices");
    assert.equal(detail?.findings[0]?.screenshotUrl, `/files/runs/${runId}/shots/pages/invoices.png`);
  });
});
