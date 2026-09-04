import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FOG_FRESH_MS, FOG_OLD_MS } from "@schema/fog";
import { fogHeatColor, fogOf, landAgeLabel } from "./fog.ts";

function hueOf(color: string): number {
  const m = /^hsl\((\d+) /.exec(color);
  assert.ok(m, color);
  return Number(m[1]);
}

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

describe("fogHeatColor", () => {
  it("follows fogHunger: green today, yellow at 2d, redder toward 40d", () => {
    const now = Date.parse("2026-09-04T12:00:00.000Z");
    const ago = (ms: number) => new Date(now - ms).toISOString();
    const fresh = hueOf(fogHeatColor(ago(0), now));
    const haze = hueOf(fogHeatColor(ago(FOG_FRESH_MS), now));
    const midOld = hueOf(fogHeatColor(ago((FOG_FRESH_MS + FOG_OLD_MS) / 2), now));
    const old = hueOf(fogHeatColor(ago(FOG_OLD_MS), now));
    const older = hueOf(fogHeatColor(ago(FOG_OLD_MS * 2), now));
    const missing = hueOf(fogHeatColor(undefined, now));
    assert.ok(fresh >= 130 && fresh <= 150, `fresh hue ${fresh}`);
    assert.ok(haze >= 40 && haze <= 55, `2d hue ${haze}`);
    assert.ok(midOld < haze && midOld > old, `21d hue ${midOld}`);
    assert.ok(old <= 10, `40d hue ${old}`);
    assert.equal(older, old);
    assert.equal(missing, old);
    const dayOne = hueOf(fogHeatColor(ago(FOG_FRESH_MS / 2), now));
    assert.ok(dayOne < fresh && dayOne > haze, `1d hue ${dayOne}`);
  });
});
