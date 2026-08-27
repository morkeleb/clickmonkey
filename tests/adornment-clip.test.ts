import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scanAdornmentClip } from "../src/surveyor/adornment-clip.js";
import { withPage } from "./helpers/with-page.js";

const html = fileURLToPath(new URL("../fixtures/sites/adornment-clip/index.html", import.meta.url));

describe("scanAdornmentClip", () => {
  it("flags a value and tab colliding with a trailing icon, not padded or date fields", async () => {
    await withPage(html, async (page) => {
      const issues = await scanAdornmentClip(page);
      const clips = issues.filter((i) => i.rule === "clip");
      assert.ok(
        clips.some(
          (i) =>
            /100\.00%/.test(i.where ?? "") &&
            /value collides with a trailing icon/i.test(i.message) &&
            i.source === "visual",
        ),
        `expected clipped amount, got ${JSON.stringify(issues)}`,
      );
      assert.ok(
        clips.some(
          (i) =>
            /Profitability/i.test(i.where ?? "") &&
            /tab title collides with a trailing icon/i.test(i.message) &&
            i.source === "visual",
        ),
        `expected clipped tab, got ${JSON.stringify(issues)}`,
      );
      assert.ok(
        clips.every((i) => !/88\.00%/.test(i.where ?? "")),
        `padding-right must leave a gap before the icon, got ${JSON.stringify(issues)}`,
      );
      assert.ok(
        clips.every((i) => !/2024-06-15|when/i.test(`${i.where} ${i.message}`)),
        `native date UA icon must not be clip, got ${JSON.stringify(issues)}`,
      );
      assert.ok(clips.length <= 8);
    });
  });
});
