import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { identityFromRunId } from "../src/ui/identity.js";

describe("identityFromRunId", () => {
  it("is stable for the same run id", () => {
    const a = identityFromRunId("20260818T150000Z-ab12");
    const b = identityFromRunId("20260818T150000Z-ab12");
    assert.equal(a.name, b.name);
    assert.equal(a.hue, b.hue);
    assert.match(a.name, /^[a-z]+-[a-z]+$/);
    assert.ok(a.hue >= 0 && a.hue <= 359);
  });

  it("usually differs across run ids", () => {
    const a = identityFromRunId("run-a");
    const b = identityFromRunId("run-b");
    assert.ok(a.name !== b.name || a.hue !== b.hue);
  });
});
