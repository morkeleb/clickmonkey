import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli/index.ts", import.meta.url));

function run(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", cli, ...args], {
    encoding: "utf8",
  });
}

describe("clickmonkey CLI chassis", () => {
  it("prints usage and exits 2 with no args", () => {
    const result = run([]);
    assert.equal(result.status, 2);
    assert.match(result.stdout, /Usage:/);
    assert.match(result.stdout, /inspect/);
  });

  it("prints the version", () => {
    const result = run(["--version"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /2\.0\.0-alpha\.0/);
  });

  it("rejects an unknown command with exit 2", () => {
    const result = run(["xyzzy"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Unknown command: xyzzy/);
  });

  it("lists unleash and explore in usage", () => {
    const result = run([]);
    assert.match(result.stdout, /unleash/);
    assert.match(result.stdout, /explore/);
  });

  it("explore without brain exits 2 with a provider table", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-explore-nobrain-"));
    const cfg = join(dir, "clickmonkey.json");
    writeFileSync(
      cfg,
      `${JSON.stringify({ url: "http://127.0.0.1:4173/", map: { schemaVersion: 1, app: "x", pages: [] } })}\n`,
    );
    const result = run(["explore", "--config", cfg]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Ollama/);
    assert.match(result.stderr, /OpenAI/);
    assert.match(result.stderr, /Anthropic/);
  });
});
