import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { extractClickmonkeyFences } from "../src/reports/fences.js";
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

describe("clickmonkey report / replay report", () => {
  it("builds a markdown report from a failing playbook and replay still fails", async () => {
    const { baseUrl, close } = await serveSite("accepts-empty");
    const tmp = mkdtempSync(join(tmpdir(), "cm-report-"));
    const cfg = join(tmp, "clickmonkey.json");
    try {
      assert.equal((await run(["init", "--url", baseUrl, "--config", cfg])).status, 0);
      assert.equal((await run(["inspect", "--config", cfg])).status, 0);
      const runDir = join(tmp, "clickmonkey", "runs", "sess1");
      const playbook = await run(["playbook", "empty-required", "--config", cfg, "--out", runDir]);
      assert.equal(playbook.status, 1, `${playbook.stdout}\n${playbook.stderr}`);
      const reportPath = join(tmp, "clickmonkey", "findings.md");
      const report = await run(["report", "--config", cfg, "--runs", "sess1", "--out", reportPath]);
      assert.equal(report.status, 1, `${report.stdout}\n${report.stderr}`);
      assert.ok(existsSync(reportPath));
      const md = readFileSync(reportPath, "utf8");
      assert.match(md, /# Findings report/);
      assert.match(md, /```clickmonkey/);
      const fences = extractClickmonkeyFences(md);
      assert.ok(fences.length >= 1, "expected a clickmonkey fence");
      const replayed = await run([
        "replay",
        reportPath,
        "--config",
        cfg,
        "--out",
        join(tmp, "clickmonkey", "runs", "replay-report"),
      ]);
      assert.equal(replayed.status, 1, `${replayed.stdout}\n${replayed.stderr}`);
      assert.match(replayed.stdout, /STILL/);
      assert.match(replayed.stdout, /comparison:/);
      const comparison = join(tmp, "clickmonkey", "runs", "replay-report", "comparison.md");
      assert.ok(existsSync(comparison), "comparison.md");
      const verdict = readFileSync(comparison, "utf8");
      assert.match(verdict, /# Replay comparison/);
      assert.match(verdict, /Before/);
      assert.match(verdict, /After/);
      assert.ok(existsSync(join(tmp, "clickmonkey", "runs", "replay-report", "case-01", "after.png")));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await close();
    }
  });
});
