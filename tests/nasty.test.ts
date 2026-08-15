import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideUnleashNasty, loadPayloads, pickNasty } from "../src/brains/nasty.js";
import { parseLine } from "../src/schema/dsl.js";
import type { View } from "../src/schema/view.js";

function viewOf(partial: Partial<View>): View {
  return {
    page: "home",
    surface: "page",
    stack: ["page"],
    shown: [],
    actions: [],
    ...partial,
  };
}

describe("nasty payloads", () => {
  it("loadPayloads has sqli and xss", () => {
    const catalog = loadPayloads();
    assert.ok(Array.isArray(catalog.sqli) && catalog.sqli.length > 0);
    assert.ok(Array.isArray(catalog.xss) && catalog.xss.length > 0);
    assert.ok(catalog.sqli!.some((p) => p.includes("OR") || p.includes("DROP")));
    assert.ok(catalog.xss!.some((p) => p.includes("<script>") || p.includes("onerror=")));
  });

  it("pickNasty returns a string from the catalog", () => {
    const catalog = loadPayloads();
    const pool = [
      ...(catalog.xss ?? []),
      ...(catalog.sqli ?? []),
      ...(catalog.format ?? []),
      ...(catalog.overlong ?? []),
    ];
    assert.ok(pool.length > 0);
    for (let i = 0; i < 40; i++) {
      const value = pickNasty("text");
      assert.equal(typeof value, "string");
      assert.ok(pool.includes(value), value);
    }
    const first = pickNasty("email", () => 0);
    assert.ok(pool.includes(first), first);
  });

  it("decideUnleashNasty fill lines use a catalog value when filling", () => {
    const catalog = loadPayloads();
    const pool = [
      ...(catalog.xss ?? []),
      ...(catalog.sqli ?? []),
      ...(catalog.format ?? []),
      ...(catalog.overlong ?? []),
    ];
    const view = viewOf({
      shown: [{ id: "name", value: "", type: "text" }],
    });
    for (let i = 0; i < 20; i++) {
      const decision = decideUnleashNasty({ view, stepsUsed: i }, () => 0);
      const parsed = parseLine(decision.line);
      assert.ok(parsed && !("comment" in parsed), decision.line);
      assert.equal(parsed.kind, "fill");
      if (parsed.kind === "fill") {
        assert.ok(pool.includes(parsed.value), parsed.value);
      }
    }
  });
});
