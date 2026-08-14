import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
    const result = run(["unleash"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Unknown command: unleash/);
  });
});
