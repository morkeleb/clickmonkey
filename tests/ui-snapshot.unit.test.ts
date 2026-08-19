import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { saveConfig } from "../src/persist/config.js";
import { exploreOutlineOf, setPresenceOutline, startPresence } from "../src/persist/presence.js";
import { emptyConfig } from "../src/schema/config.js";
import { buildUiSnapshot } from "../src/ui/snapshot.js";

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
      assert.ok(snap.leash.intro.some((line) => line.includes("$CLICKMONKEY_PASSWORD")));
      assert.equal(json.includes("sk-super-secret-xyz"), false);
      assert.equal(json.includes("hunter2-resolved"), false);
      assert.equal(json.includes("apiKey"), false);
      assert.equal(json.includes("apiKeyEnv"), false);
      assert.equal(json.includes("XAI_API_KEY"), false);
      assert.ok(snap.reports.some((r) => r.id === "20260818T160000Z-ccdd" && r.findingCount === 2));
      assert.ok(snap.reports.some((r) => r.id === "findings"));
      const run = snap.runs.find((r) => r.id === "20260818T150000Z-ab12");
      assert.ok(run?.pageId === "home");
      assert.equal(run.brain, "explore");
      assert.equal(run.outline?.charter, "walk invoices");
      assert.equal(run.outline?.now, "open invoices");
      assert.equal(run.steps?.[0]?.line, "open home");
      assert.equal(run.steps?.[0]?.ok, true);
    } finally {
      if (prevKey === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = prevKey;
      if (prevPw === undefined) delete process.env.CLICKMONKEY_PASSWORD;
      else process.env.CLICKMONKEY_PASSWORD = prevPw;
    }
  });
});
