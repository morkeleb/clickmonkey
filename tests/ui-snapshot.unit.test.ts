import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { saveConfig } from "../src/persist/config.js";
import { exploreOutlineOf, setPresenceOutline, startPresence } from "../src/persist/presence.js";
import { emptyConfig } from "../src/schema/config.js";
import { touchLand } from "../src/persist/lands.js";
import { buildUiSnapshot, refreshUiSnapshot } from "../src/ui/snapshot.js";

describe("buildUiSnapshot", () => {
  it("omits apiKey and resolved $ENV secrets", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-ui-snap-"));
    const path = join(dir, "clickmonkey.json");
    const prevKey = process.env.XAI_API_KEY;
    const prevPw = process.env.CLICKMONKEY_PASSWORD;
    process.env.XAI_API_KEY = "sk-super-secret-xyz";
    process.env.CLICKMONKEY_PASSWORD = "hunter2-resolved";
    try {
      const base = emptyConfig("http://127.0.0.1:4173/");
      saveConfig(path, {
        ...base,
        intro: [
          "fill login.user $CLICKMONKEY_USER",
          "fill login.password $CLICKMONKEY_PASSWORD",
          "click login.submit",
        ],
        skip: ["logout"],
        brain: {
          baseUrl: "https://api.x.ai/v1",
          model: "grok-3",
          apiKeyEnv: "XAI_API_KEY",
        },
        vision: {
          baseUrl: "https://vision.internal.example/v1",
          model: "qwen2.5-vl",
          apiKeyEnv: "XAI_API_KEY",
        },
      });
      const runDir = join(dir, "clickmonkey", "runs", "20260818T150000Z-ab12");
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, "log.txt"), "open home\n");
      writeFileSync(
        join(runDir, "nav.jsonl"),
        `${JSON.stringify({
          ts: "2026-08-18T15:00:01.000Z",
          type: "step",
          line: "open home",
          pageId: "home",
          phase: "walk",
        })}\n${JSON.stringify({
          ts: "2026-08-18T15:00:01.200Z",
          type: "stepDone",
          line: "open home",
          ok: true,
          ms: 200,
        })}\n`,
      );
      startPresence(runDir, { pageId: "home", brain: "explore" });
      setPresenceOutline(runDir, exploreOutlineOf({ charter: "walk invoices", now: "open invoices" }));
      writeFileSync(join(dir, "clickmonkey", "findings.md"), "# findings\n- **runs:** 20260818T150000Z-ab12\n");
      const reportDir = join(dir, "clickmonkey", "reports", "20260818T160000Z-ccdd");
      mkdirSync(reportDir, { recursive: true });
      writeFileSync(
        join(reportDir, "report.json"),
        `${JSON.stringify({
          schemaVersion: 1,
          id: "20260818T160000Z-ccdd",
          generatedAt: "2026-08-18T16:00:00.000Z",
          url: "http://127.0.0.1:4173/",
          runIds: ["20260818T150000Z-ab12"],
          findingCount: 2,
          title: "2 findings · 20260818T150000Z-ab12",
        })}\n`,
      );
      writeFileSync(join(reportDir, "findings.md"), "# Findings report\n");

      const snap = buildUiSnapshot(path);
      const json = JSON.stringify(snap);
      assert.equal(snap.schemaVersion, 1);
      assert.equal(snap.leash.brainModel, "grok-3");
      assert.equal(snap.leash.screenshots, true);
      assert.equal(snap.leash.visionModel, "qwen2.5-vl");
      assert.ok(snap.leash.intro.some((line) => line.includes("$CLICKMONKEY_PASSWORD")));
      assert.equal(json.includes("sk-super-secret-xyz"), false);
      assert.equal(json.includes("hunter2-resolved"), false);
      assert.equal(json.includes("apiKey"), false);
      assert.equal(json.includes("apiKeyEnv"), false);
      assert.equal(json.includes("XAI_API_KEY"), false);
      assert.equal(json.includes("vision.internal.example"), false);
      assert.ok(snap.reports.some((r) => r.id === "20260818T160000Z-ccdd" && r.findingCount === 2));
      assert.ok(snap.reports.some((r) => r.id === "findings"));
      const run = snap.runs.find((r) => r.id === "20260818T150000Z-ab12");
      assert.ok(run?.pageId === "home");
      assert.equal(run.brain, "explore");
      assert.equal(run.outline?.charter, "walk invoices");
      assert.equal(run.outline?.now, "open invoices");
      assert.equal(run.steps, undefined);
    } finally {
      if (prevKey === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = prevKey;
      if (prevPw === undefined) delete process.env.CLICKMONKEY_PASSWORD;
      else process.env.CLICKMONKEY_PASSWORD = prevPw;
    }
  });

  it("attaches the latest walk screenshot to a map page", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-ui-shot-"));
    const path = join(dir, "clickmonkey.json");
    saveConfig(path, {
      ...emptyConfig("http://127.0.0.1:4173/"),
      map: {
        schemaVersion: 1,
        app: "x",
        generation: 1,
        pages: [
          {
            id: "home",
            path: "/",
            params: [],
            ready: { by: "testId", value: "home" },
            surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
          },
        ],
      },
    });
    const runDir = join(dir, "clickmonkey", "runs", "20260818T150000Z-ab12");
    mkdirSync(join(runDir, "shots"), { recursive: true });
    writeFileSync(join(runDir, "log.txt"), "open home\n");
    writeFileSync(join(runDir, "shots", "step-000.png"), "png");
    writeFileSync(
      join(runDir, "nav.jsonl"),
      `${JSON.stringify({
        ts: "2026-08-18T15:00:01.000Z",
        type: "step",
        line: "open home",
        pageId: "home",
        phase: "walk",
      })}\n${JSON.stringify({
        ts: "2026-08-18T15:00:01.200Z",
        type: "stepDone",
        line: "open home",
        ok: true,
        ms: 200,
      })}\n`,
    );
    const snap = buildUiSnapshot(path);
    const home = snap.graph.nodes.find((n) => n.id === "home");
    assert.equal(home?.screenshotUrl, "/files/runs/20260818T150000Z-ab12/shots/step-000.png");
    assert.equal(snap.runs[0]?.steps, undefined);
    const patched = refreshUiSnapshot(snap, path, "findings");
    assert.equal(
      patched.graph.nodes.find((n) => n.id === "home")?.screenshotUrl,
      "/files/runs/20260818T150000Z-ab12/shots/step-000.png",
    );
    touchLand(path, "home", "2026-01-02T00:00:00.000Z");
    const runPatch = refreshUiSnapshot(snap, path, "runs");
    assert.equal(runPatch.graph.nodes.find((n) => n.id === "home")?.screenshotUrl, home?.screenshotUrl);
    assert.equal(runPatch.graph.nodes.find((n) => n.id === "home")?.lastLandAt, "2026-01-02T00:00:00.000Z");
  });

  it("attaches screenshots from a live run that has no log.txt yet", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-ui-live-shot-"));
    const path = join(dir, "clickmonkey.json");
    saveConfig(path, {
      ...emptyConfig("http://127.0.0.1:4173/"),
      map: {
        schemaVersion: 1,
        app: "x",
        generation: 1,
        pages: [
          {
            id: "home",
            path: "/",
            params: [],
            ready: { by: "testId", value: "home" },
            surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
          },
        ],
      },
    });
    const runDir = join(dir, "clickmonkey", "runs", "20260818T160000Z-live");
    mkdirSync(join(runDir, "shots"), { recursive: true });
    writeFileSync(join(runDir, "shots", "step-003.png"), "png");
    writeFileSync(
      join(runDir, "nav.jsonl"),
      [
        JSON.stringify({ ts: "t0", type: "step", line: "open home", pageId: "home", phase: "walk" }),
        JSON.stringify({ ts: "t1", type: "stepDone", line: "open home", ok: true, ms: 10 }),
        JSON.stringify({ ts: "t2", type: "step", line: "click page.go", pageId: "home", phase: "walk" }),
        JSON.stringify({ ts: "t3", type: "stepDone", line: "click page.go", ok: true, ms: 10 }),
        JSON.stringify({ ts: "t4", type: "step", line: "click page.more", pageId: "home", phase: "walk" }),
        JSON.stringify({ ts: "t5", type: "stepDone", line: "click page.more", ok: true, ms: 10 }),
        JSON.stringify({ ts: "t6", type: "step", line: "click page.next", pageId: "home", phase: "walk" }),
        JSON.stringify({ ts: "t7", type: "stepDone", line: "click page.next", ok: true, ms: 10 }),
      ].join("\n"),
    );
    const snap = buildUiSnapshot(path);
    const home = snap.graph.nodes.find((n) => n.id === "home");
    assert.equal(home?.screenshotUrl, "/files/runs/20260818T160000Z-live/shots/step-003.png");
  });

  it("does not put a navigated-away still on the page the click started on", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-ui-shot-hop-"));
    const path = join(dir, "clickmonkey.json");
    saveConfig(path, {
      ...emptyConfig("http://127.0.0.1:4173/"),
      map: {
        schemaVersion: 1,
        app: "x",
        generation: 1,
        pages: [
          {
            id: "home",
            path: "/",
            params: [],
            ready: { by: "testId", value: "home" },
            surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
          },
          {
            id: "schema_analysis_run",
            path: "/runs/abc",
            params: [],
            ready: { by: "testId", value: "run" },
            surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
          },
        ],
      },
    });
    const runDir = join(dir, "clickmonkey", "runs", "20260818T170000Z-hop");
    mkdirSync(join(runDir, "shots"), { recursive: true });
    writeFileSync(join(runDir, "shots", "step-000.png"), "png");
    writeFileSync(
      join(runDir, "nav.jsonl"),
      [
        JSON.stringify({
          ts: "t0",
          type: "step",
          line: "click page.dashboard_card",
          pageId: "home",
          phase: "walk",
        }),
        JSON.stringify({
          ts: "t1",
          type: "nav",
          from: "http://127.0.0.1:4173/",
          to: "http://127.0.0.1:4173/runs/abc",
          via: "commit",
        }),
        JSON.stringify({ ts: "t2", type: "stepDone", line: "click page.dashboard_card", ok: true, ms: 10 }),
      ].join("\n"),
    );
    const snap = buildUiSnapshot(path);
    const home = snap.graph.nodes.find((n) => n.id === "home");
    const run = snap.graph.nodes.find((n) => n.id === "schema_analysis_run");
    assert.equal(home?.screenshotUrl, undefined);
    assert.equal(run?.screenshotUrl, "/files/runs/20260818T170000Z-hop/shots/step-000.png");
  });

  it("uses the landing step shot, not a stale pages/ still after a hop away", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-ui-shot-pages-"));
    const path = join(dir, "clickmonkey.json");
    saveConfig(path, {
      ...emptyConfig("http://127.0.0.1:4173/"),
      map: {
        schemaVersion: 1,
        app: "x",
        generation: 1,
        pages: [
          {
            id: "home",
            path: "/",
            params: [],
            ready: { by: "testId", value: "home" },
            surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
          },
          {
            id: "schema_analysis_run",
            path: "/runs/abc",
            params: [],
            ready: { by: "testId", value: "run" },
            surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
          },
        ],
      },
    });
    const runDir = join(dir, "clickmonkey", "runs", "20260818T180000Z-pages");
    mkdirSync(join(runDir, "shots", "pages"), { recursive: true });
    writeFileSync(join(runDir, "shots", "pages", "home.png"), "home");
    writeFileSync(join(runDir, "shots", "pages", "schema_analysis_run.png"), "run");
    writeFileSync(join(runDir, "shots", "step-000.png"), "home-step");
    writeFileSync(join(runDir, "shots", "step-001.png"), "run-step");
    writeFileSync(
      join(runDir, "nav.jsonl"),
      [
        JSON.stringify({ ts: "t0", type: "step", line: "expect path /", pageId: "home", phase: "walk" }),
        JSON.stringify({ ts: "t1", type: "stepDone", line: "expect path /", ok: true, ms: 10, pageId: "home" }),
        JSON.stringify({
          ts: "t2",
          type: "step",
          line: "click page.go",
          pageId: "home",
          phase: "walk",
        }),
        JSON.stringify({
          ts: "t3",
          type: "nav",
          from: "http://127.0.0.1:4173/",
          to: "http://127.0.0.1:4173/runs/abc",
          via: "commit",
        }),
        JSON.stringify({
          ts: "t4",
          type: "stepDone",
          line: "click page.go",
          ok: true,
          ms: 10,
          pageId: "schema_analysis_run",
        }),
      ].join("\n"),
    );
    const snap = buildUiSnapshot(path);
    assert.equal(
      snap.graph.nodes.find((n) => n.id === "home")?.screenshotUrl,
      "/files/runs/20260818T180000Z-pages/shots/step-000.png",
    );
    assert.equal(
      snap.graph.nodes.find((n) => n.id === "schema_analysis_run")?.screenshotUrl,
      "/files/runs/20260818T180000Z-pages/shots/step-001.png",
    );
  });

  it("keeps nth on a duplicate action and ignores unknown widget keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-ui-nth-"));
    const path = join(dir, "clickmonkey.json");
    saveConfig(path, emptyConfig("http://127.0.0.1:4173/"));
    writeFileSync(
      join(dir, "clickmonkey", "map.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        app: "x",
        generation: 1,
        pages: [
          {
            id: "home",
            path: "/",
            params: [],
            ready: { by: "testId", value: "home" },
            surfaces: [
              {
                id: "page",
                kind: "page",
                fields: [],
                actions: [
                  { id: "employees", by: "role", value: "button", name: "Employees", status: "ok" },
                  {
                    id: "employeesList",
                    by: "role",
                    value: "button",
                    name: "Employees",
                    nth: 1,
                    status: "ok",
                    futureKey: "x",
                  },
                ],
              },
            ],
          },
        ],
      })}\n`,
    );
    const snap = buildUiSnapshot(path);
    const actions = snap.map.pages[0]?.surfaces[0]?.actions;
    assert.equal(actions?.[1]?.nth, 1);
    assert.equal("futureKey" in (actions?.[1] ?? {}), false);
  });
});
