import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { saveConfig } from "../src/persist/config.js";
import { emptyConfig } from "../src/schema/config.js";
import {
  clearUiPid,
  processIsAlive,
  readUiPid,
  stopUi,
  uiSpawnArgs,
  writeUiPid,
} from "../src/ui/pid.js";

describe("ui pid", () => {
  it("round-trips a pid record", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-ui-pid-"));
    const cfg = join(dir, "clickmonkey.json");
    saveConfig(cfg, emptyConfig("http://127.0.0.1:4173/"));
    writeUiPid(cfg, { pid: 4242, port: 4174 });
    assert.deepEqual(readUiPid(cfg), { pid: 4242, port: 4174 });
    clearUiPid(cfg, 4242);
    assert.equal(readUiPid(cfg), undefined);
  });

  it("does not clear a pidfile owned by another process", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-ui-pid-keep-"));
    const cfg = join(dir, "clickmonkey.json");
    saveConfig(cfg, emptyConfig("http://127.0.0.1:4173/"));
    writeUiPid(cfg, { pid: 99, port: 4174 });
    clearUiPid(cfg, process.pid);
    assert.deepEqual(readUiPid(cfg), { pid: 99, port: 4174 });
  });

  it("stopUi kills the pidfile process", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-ui-stop-"));
    const cfg = join(dir, "clickmonkey.json");
    saveConfig(cfg, emptyConfig("http://127.0.0.1:4173/"));
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "clickmonkey", "ui"], {
      stdio: "ignore",
    });
    assert.ok(child.pid);
    writeUiPid(cfg, { pid: child.pid, port: 4174 });
    const result = await stopUi({ configPath: cfg, port: 4174 });
    assert.equal(result.stopped, true);
    assert.equal(result.pid, child.pid);
    assert.equal(processIsAlive(child.pid), false);
    assert.equal(readUiPid(cfg), undefined);
  });

  it("uiSpawnArgs rebuilds clickmonkey ui --no-open", () => {
    const { execPath, args } = uiSpawnArgs({ configPath: "/tmp/clickmonkey.json", port: 4174 });
    assert.equal(execPath, process.execPath);
    assert.match(args[0] ?? "", /clickmonkey\.mjs$/);
    assert.equal(args[1], "ui");
    assert.equal(args.at(-1), "--no-open");
    assert.ok(args.includes("/tmp/clickmonkey.json"));
    assert.ok(args.includes("4174"));
  });
});
