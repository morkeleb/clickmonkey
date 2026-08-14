import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { serveSite } from "./helpers/fixture-server.js";

const cli = fileURLToPath(new URL("../src/cli/index.ts", import.meta.url));

function run(args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", cli, ...args], {
      timeout: 180_000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

describe("clickmonkey CLI flow", () => {
  it("init, inspect, playbook, replay on validates (exit 0)", async () => {
    const { baseUrl, close } = await serveSite("validates");
    const tmp = mkdtempSync(join(tmpdir(), "cm-cli-ok-"));
    const cfg = join(tmp, "clickmonkey.json");
    try {
      const init = await run(["init", "--url", baseUrl, "--config", cfg]);
      assert.equal(init.status, 0, init.stderr);
      const inspect = await run(["inspect", "--config", cfg]);
      assert.equal(inspect.status, 0, inspect.stderr);
      assert.match(inspect.stdout, /pageId:/);
      const out = join(tmp, "out");
      const playbook = await run(["playbook", "empty-required", "--config", cfg, "--out", out]);
      assert.equal(playbook.status, 0, `${playbook.stdout}\n${playbook.stderr}`);
      const replay = await run(["replay", join(out, "replay.log"), "--config", cfg, "--out", join(tmp, "replay")]);
      assert.equal(replay.status, 0, `${replay.stdout}\n${replay.stderr}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await close();
    }
  });

  it("playbook and replay exit 1 on accepts-empty", async () => {
    const { baseUrl, close } = await serveSite("accepts-empty");
    const tmp = mkdtempSync(join(tmpdir(), "cm-cli-empty-"));
    const cfg = join(tmp, "clickmonkey.json");
    try {
      assert.equal((await run(["init", "--url", baseUrl, "--config", cfg])).status, 0);
      assert.equal((await run(["inspect", "--config", cfg])).status, 0);
      const out = join(tmp, "out");
      const playbook = await run(["playbook", "empty-required", "--config", cfg, "--out", out]);
      assert.equal(playbook.status, 1, `${playbook.stdout}\n${playbook.stderr}`);
      const replay = await run(["replay", join(out, "replay.log"), "--config", cfg, "--out", join(tmp, "replay")]);
      assert.equal(replay.status, 1, `${replay.stdout}\n${replay.stderr}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await close();
    }
  });

  it("compacts a wandering log", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "cm-cli-compact-"));
    try {
      const wander = join(tmp, "wander.log");
      writeFileSync(
        wander,
        `# bug: empty name is accepted on create
# found: 2026-08-14

click page.wander
open home
fill createDialog.name ""
click createDialog.submit
expect createDialog.name invalid
`,
      );
      const compact = await run(["compact", wander]);
      assert.equal(compact.status, 0, compact.stderr);
      assert.match(compact.stdout, /# bug: empty name is accepted on create/);
      assert.match(compact.stdout, /^open home$/m);
      assert.doesNotMatch(compact.stdout, /wander/);
      const dest = join(tmp, "short.log");
      const toFile = await run(["compact", wander, "--out", dest]);
      assert.equal(toFile.status, 0, toFile.stderr);
      assert.match(readFileSync(dest, "utf8"), /^open home$/m);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
