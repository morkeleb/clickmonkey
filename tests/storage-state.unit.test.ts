import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Config } from "../src/schema/config.js";
import { resolveStorageState } from "../src/cli/common.js";
import { withSessionConfig } from "../src/cli/commands.js";

const baseConfig: Config = Config.parse({
  url: "http://127.0.0.1:4173/",
  intro: ["fill login.user $CLICKMONKEY_USER", "click login.submit"],
  writePolicy: "validationOnly",
  screenshots: true,
  fence: { blacklist: [] },
  map: { schemaVersion: 1, app: "app", pages: [] },
});

describe("withSessionConfig", () => {
  it("clears intro when a storage state is set", () => {
    const result = withSessionConfig(baseConfig, "/some/state.json");
    assert.deepEqual(result.intro, []);
    assert.equal(result.url, baseConfig.url);
    assert.equal(result.writePolicy, baseConfig.writePolicy);
  });

  it("keeps intro when no storage state is set", () => {
    const result = withSessionConfig(baseConfig, undefined);
    assert.deepEqual(result.intro, baseConfig.intro);
  });

  it("keeps intro when storage state is empty string", () => {
    const result = withSessionConfig(baseConfig, "");
    assert.deepEqual(result.intro, baseConfig.intro);
  });
});

describe("resolveStorageState", () => {
  it("returns undefined when no value is given", () => {
    assert.equal(resolveStorageState(undefined), undefined);
  });

  it("returns the resolved path when the file exists", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cm-ss-"));
    try {
      const stateFile = join(tmp, "state.json");
      writeFileSync(stateFile, "{}");
      const result = resolveStorageState(stateFile);
      assert.equal(result, stateFile);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails with a usage error when the file does not exist", () => {
    const originalExit = process.exit;
    const originalStderr = process.stderr.write.bind(process.stderr);
    let stderr = "";
    let exitCode: number | undefined;
    process.stderr.write = ((chunk: string) => {
      stderr += chunk;
      return true;
    }) as typeof process.stderr.write;
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error("__exit__");
    }) as typeof process.exit;
    try {
      resolveStorageState("/nonexistent/path/state.json");
      assert.fail("should have exited");
    } catch (err) {
      assert.equal(exitCode, 2);
      assert.match(stderr, /storage state not found/);
    } finally {
      process.exit = originalExit;
      process.stderr.write = originalStderr;
    }
  });
});
