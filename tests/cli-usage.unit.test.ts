import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli/index.ts", import.meta.url));
const bin = fileURLToPath(new URL("../bin/clickmonkey.mjs", import.meta.url));

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

  it("lists map, unleash, explore, spec and report in usage", () => {
    const result = run([]);
    assert.match(result.stdout, /map/);
    assert.match(result.stdout, /unleash/);
    assert.match(result.stdout, /explore/);
    assert.match(result.stdout, /^\s+mcp\s/m);
    assert.match(result.stdout, /report/);
    assert.match(result.stdout, /^\s+prune\s/m);
    assert.match(result.stdout, /^\s+spec\s/m);
    assert.match(result.stdout, /^\s+ui\s/m);
    assert.match(result.stdout, /^\s+bundle\s/m);
    assert.match(result.stdout, /--verbose/);
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

  it("explore with an unreachable model exits 2 instead of walking", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-explore-down-"));
    const cfg = join(dir, "clickmonkey.json");
    writeFileSync(
      cfg,
      `${JSON.stringify({
        url: "http://127.0.0.1:4173/",
        map: { schemaVersion: 1, app: "x", pages: [] },
        brain: { baseUrl: "http://127.0.0.1:9", model: "down" },
      })}\n`,
    );
    const result = run(["explore", "--config", cfg]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /cannot reach the language model/);
    assert.match(result.stderr, /http:\/\/127\.0\.0\.1:9/);
  });

  it("init from another cwd writes the leash there", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-init-cwd-"));
    const result = spawnSync(process.execPath, [bin, "init", "--url", "http://127.0.0.1:4173/"], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(existsSync(join(dir, "clickmonkey.json")));
  });
});
