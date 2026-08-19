import assert from "node:assert/strict";
import { globSync } from "node:fs";
import { describe, it } from "node:test";
import { listTestFiles } from "../scripts/run-tests.mjs";

describe("test file globs", () => {
  it("puts every tests/**/*.test.ts in unit or live, not both", () => {
    const all = globSync("tests/**/*.test.ts")
      .filter((file) => !file.includes("/helpers/"))
      .sort();
    const unit = listTestFiles("unit");
    const live = listTestFiles("live");
    assert.ok(unit.length > 0, "expected unit tests");
    assert.ok(live.length > 0, "expected live tests");
    assert.deepEqual([...unit, ...live].sort(), all);
    assert.equal(new Set([...unit, ...live]).size, all.length);
    for (const file of unit) assert.ok(file.endsWith(".unit.test.ts"), file);
    for (const file of live) assert.ok(!file.endsWith(".unit.test.ts"), file);
  });
});
