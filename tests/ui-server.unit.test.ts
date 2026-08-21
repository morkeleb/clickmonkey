import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { saveConfig } from "../src/persist/config.js";
import { emptyConfig } from "../src/schema/config.js";
import { readUiPid, uiPidPath } from "../src/ui/pid.js";
import { startUiServer } from "../src/ui/server.js";

describe("ui server", () => {
  it("serves a snapshot for writePolicy allow and 404s missing json instead of index.html", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-ui-srv-"));
    const cfg = join(dir, "clickmonkey.json");
    saveConfig(cfg, { ...emptyConfig("http://127.0.0.1:4173/"), writePolicy: "allow" });
    const server = await startUiServer({ configPath: cfg, port: 0, open: false });
    try {
      const snap = await fetch(`${server.url}api/snapshot`);
      assert.equal(snap.status, 200);
      assert.match(snap.headers.get("content-type") ?? "", /json/);
      const body = (await snap.json()) as { leash: { writePolicy: string } };
      assert.equal(body.leash.writePolicy, "allow");

      const missing = await fetch(`${server.url}snapshot.json`);
      assert.equal(missing.status, 404);
      const text = await missing.text();
      assert.doesNotMatch(text, /<!doctype/i);

      const rec = readUiPid(cfg);
      assert.equal(rec?.pid, process.pid);
      assert.ok(existsSync(uiPidPath(cfg)));
    } finally {
      await server.close();
    }
    assert.equal(existsSync(uiPidPath(cfg)), false);
  });

  it("restarts via POST /api/restart without spawning when hooked", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-ui-rst-"));
    const cfg = join(dir, "clickmonkey.json");
    saveConfig(cfg, emptyConfig("http://127.0.0.1:4173/"));
    let spawned: { configPath: string; port: number } | undefined;
    const server = await startUiServer({
      configPath: cfg,
      port: 0,
      open: false,
      spawnRestart: (opts) => {
        spawned = opts;
      },
    });
    const port = Number(new URL(server.url).port);
    const res = await fetch(`${server.url}api/restart`, { method: "POST" });
    assert.equal(res.status, 202);
    await server.stopped;
    await server.close();
    assert.deepEqual(spawned, { configPath: cfg, port });
    await assert.rejects(() => fetch(server.url, { signal: AbortSignal.timeout(500) }));
  });

  it("returns a copyable restart fault when the snapshot cannot be built", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-ui-fault-"));
    const cfg = join(dir, "clickmonkey.json");
    saveConfig(cfg, emptyConfig("http://127.0.0.1:4173/"));
    mkdirSync(join(dir, "clickmonkey"), { recursive: true });
    writeFileSync(
      join(dir, "clickmonkey", "testability.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        pages: [
          {
            path: "/",
            foundAt: "t",
            insufficient: false,
            issues: [{ code: "notARealCode", severity: "warn", tag: "div" }],
          },
        ],
      })}\n`,
    );
    const server = await startUiServer({ configPath: cfg, port: 0, open: false });
    try {
      const res = await fetch(`${server.url}api/snapshot`);
      assert.equal(res.status, 503);
      const body = (await res.json()) as { error: boolean; copy: string; hint: string };
      assert.equal(body.error, true);
      assert.match(body.copy, /clickmonkey ui --stop/);
      assert.match(body.copy, /clickmonkey ui --port 4174/);
      assert.match(body.hint, /Hard-refresh/);
    } finally {
      await server.close();
    }
  });
});
