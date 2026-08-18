import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { bootRun } from "../src/executor/boot.js";
import { createExecutor } from "../src/executor/run.js";
import { withRun } from "../src/executor/session.js";
import { emptyConfig } from "../src/schema/config.js";
import { serveSite } from "./helpers/fixture-server.js";

describe("verbose dumps", () => {
  it("writes HTML and view files per step under verbose/", async () => {
    const { baseUrl, close } = await serveSite("nav");
    const outDir = mkdtempSync(join(tmpdir(), "cm-verbose-"));
    try {
      await withRun({}, async (handle) => {
        const state = await bootRun(handle, emptyConfig(baseUrl), outDir, { verbose: true });
        const exec = createExecutor(state);
        const result = await exec.runLine("open home");
        assert.equal(result.ok, true, result.finding?.message);
      });
      const dir = join(outDir, "verbose");
      assert.ok(existsSync(join(dir, "000.html")), "boot html");
      assert.ok(existsSync(join(dir, "000.view.txt")), "boot view");
      assert.ok(existsSync(join(dir, "001.html")), "step html");
      assert.ok(existsSync(join(dir, "001.view.txt")), "step view");
      const index = readFileSync(join(dir, "index.jsonl"), "utf8");
      assert.match(index, /"line":"boot"/);
      assert.match(index, /"line":"open home"/);
      const html = readFileSync(join(dir, "000.html"), "utf8");
      assert.match(html, /<html/i);
      const view = readFileSync(join(dir, "001.view.txt"), "utf8");
      assert.match(view, /page:/);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      await close();
    }
  });
});
