import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { firstFamily, formatFont, normalizeWeight, pickFonts } from "../src/executor/look.js";

describe("look helpers", () => {
  it("firstFamily takes the first quoted or bare face", () => {
    assert.equal(firstFamily('"Times New Roman", Times, serif'), "Times New Roman");
    assert.equal(firstFamily("Arial, sans-serif"), "Arial");
    assert.equal(firstFamily("sans-serif"), "sans-serif");
  });

  it("normalizeWeight maps CSS keywords", () => {
    assert.equal(normalizeWeight("normal"), "400");
    assert.equal(normalizeWeight("bold"), "700");
    assert.equal(normalizeWeight("600"), "600");
  });

  it("pickFonts keeps the common face and family outliers", () => {
    const picked = pickFonts([
      { family: "Arial", size: "16px", weight: "400", count: 12 },
      { family: "Arial", size: "14px", weight: "400", count: 4 },
      { family: "Arial", size: "12px", weight: "400", count: 2 },
      { family: "Arial", size: "11px", weight: "400", count: 1 },
      { family: "Times New Roman", size: "20px", weight: "700", count: 1 },
    ]);
    assert.ok(picked.some((f) => f.family === "Arial" && f.size === "16px"));
    assert.ok(picked.some((f) => f.family === "Times New Roman"));
    assert.equal(formatFont(picked[0]!), "Arial 16px/400 (12)");
  });
});
