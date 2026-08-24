import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fogOf, landAgeLabel } from "./fog.ts";

describe("landAgeLabel", () => {
  it("calls a future timestamp just now, not never visited", () => {
    const now = Date.parse("2026-08-23T12:00:00.000Z");
    assert.equal(landAgeLabel("2026-08-23T12:01:00.000Z", now), "visited just now");
    assert.equal(landAgeLabel(undefined, now), "never visited");
    assert.equal(landAgeLabel("nope", now), "never visited");
    assert.equal(landAgeLabel("2026-08-23T10:00:00.000Z", now), "visited 2h ago");
    assert.ok(fogOf(undefined) === 1);
    assert.ok(fogOf("2026-08-23T12:00:00.000Z", now) < 0.4);
  });
});
