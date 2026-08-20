import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { saveConfig } from "../src/persist/config.js";
import { emptyConfig } from "../src/schema/config.js";
import { freezeSnapshot, writeBundle } from "../src/ui/bundle.js";
import type { UiSnapshot } from "../src/schema/ui.js";

describe("writeBundle", () => {
  it("writes a static folder with snapshot, run json, shots, and live=false", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-bundle-"));
    const cfg = join(dir, "clickmonkey.json");
    saveConfig(cfg, emptyConfig("http://127.0.0.1:4173/"));
    const runId = "20260818T220000Z-abcd";
    const runDir = join(dir, "clickmonkey", "runs", runId);
    mkdirSync(join(runDir, "findings", "fnd_0_pageError"), { recursive: true });
    writeFileSync(join(runDir, "log.txt"), "open home\n");
    writeFileSync(join(runDir, "findings", "fnd_0_pageError", "screenshot.png"), "png");
    mkdirSync(join(runDir, "verbose"), { recursive: true });
    writeFileSync(join(runDir, "verbose", "skip.html"), "nope");

    const uiRoot = join(dir, "ui-dist");
    mkdirSync(uiRoot, { recursive: true });
    writeFileSync(join(uiRoot, "index.html"), "<!doctype html><title>ui</title>");

    const out = join(dir, "bundle");
    const written = writeBundle(cfg, out, { uiRoot });
    assert.equal(written.outDir, out);
    assert.ok(existsSync(join(out, "index.html")));
    assert.ok(existsSync(join(out, "snapshot.json")));
    assert.ok(existsSync(join(out, "README.txt")));
    const snap = JSON.parse(readFileSync(join(out, "snapshot.json"), "utf8")) as UiSnapshot;
    assert.equal(snap.runs.every((r) => r.live === false), true);
    assert.ok(existsSync(join(out, "api", "runs", `${runId}.json`)));
    assert.ok(existsSync(join(out, "files", "runs", runId, "findings", "fnd_0_pageError", "screenshot.png")));
    assert.equal(existsSync(join(out, "files", "runs", runId, "verbose", "skip.html")), false);
  });

  it("freezeSnapshot clears live flags", () => {
    const frozen = freezeSnapshot({
      runs: [
        { live: true, id: "a" },
        { live: false, id: "b" },
      ],
    });
    assert.deepEqual(
      frozen.runs.map((r) => r.live),
      [false, false],
    );
    const withNotice = freezeSnapshot({
      runs: [{ live: true, id: "a" }],
      notice: { level: "warn" as const, title: "stale", message: "restart" },
    });
    assert.equal("notice" in withNotice, false);
  });
});
