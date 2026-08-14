import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { saveConfig } from "../src/persist/config.js";
import { runEmptyRequired } from "../src/playbooks/empty-required.js";
import { emptyConfig } from "../src/schema/config.js";
import { serveSite } from "./helpers/fixture-server.js";

function findingFiles(dir: string): string[] {
  const root = join(dir, "findings");
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => name.startsWith("fnd_"))
    .map((name) => join(root, name, "finding.json"))
    .filter((path) => existsSync(path));
}

describe("empty-required playbook", () => {
  it("records expectFailed on accepts-empty", async () => {
    const { baseUrl, close } = await serveSite("accepts-empty");
    const tmp = mkdtempSync(join(tmpdir(), "cm-er-empty-"));
    const configPath = join(tmp, "clickmonkey.json");
    const outDir = join(tmp, "out");
    try {
      saveConfig(configPath, emptyConfig(baseUrl));
      const result = await runEmptyRequired({ config: emptyConfig(baseUrl), configPath, outDir });
      assert.equal(result.ok, false);
      assert.equal(result.log.result, "failed");
      const failed = result.findings.find((f) => f.kind === "expectFailed");
      assert.ok(failed, "expected an expectFailed finding");
      assert.ok(existsSync(result.logPath));
      const tape = readFileSync(result.logPath, "utf8");
      assert.match(tape, /# bug:/);
      assert.match(tape, /expect \S+ invalid/);
      assert.ok(failed.screenshotPath && existsSync(failed.screenshotPath));
      assert.ok(findingFiles(outDir).length > 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await close();
    }
  });

  it("passes on validates with no Finding files", async () => {
    const { baseUrl, close } = await serveSite("validates");
    const tmp = mkdtempSync(join(tmpdir(), "cm-er-ok-"));
    const configPath = join(tmp, "clickmonkey.json");
    const outDir = join(tmp, "out");
    try {
      saveConfig(configPath, emptyConfig(baseUrl));
      const result = await runEmptyRequired({ config: emptyConfig(baseUrl), configPath, outDir });
      assert.equal(result.ok, true);
      assert.equal(result.findings.length, 0);
      assert.equal(result.log.result, "passed");
      assert.deepEqual(findingFiles(outDir), []);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await close();
    }
  });
});
