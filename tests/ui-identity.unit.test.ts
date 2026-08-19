import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { identityFromRunId, pickDistinctHue, hueDistance, HUE_SLOTS } from "../src/ui/identity.js";

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

describe("pickDistinctHue", () => {
  it("snaps the first monkey onto the 12-slot wheel", () => {
    const h = pickDistinctHue([], 47);
    assert.equal(h, 60);
    assert.equal(h % (360 / HUE_SLOTS), 0);
  });

  it("places the next monkey opposite the first", () => {
    assert.equal(pickDistinctHue([0], 0), 180);
    assert.equal(hueDistance(0, 180), 180);
  });

  it("keeps 12 live hues at least 30° apart", () => {
    const taken: number[] = [];
    for (let i = 0; i < HUE_SLOTS; i++) {
      const h = pickDistinctHue(taken, i * 17);
      for (const t of taken) assert.ok(hueDistance(h, t) >= 30, `${h} vs ${t}`);
      taken.push(h);
    }
    assert.equal(new Set(taken).size, HUE_SLOTS);
  });
});
