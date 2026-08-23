import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scanTableLayout } from "../src/surveyor/scanline.js";
import { withPage } from "./helpers/with-page.js";

const html = fileURLToPath(new URL("../fixtures/sites/sparse/index.html", import.meta.url));

describe("scanTableLayout sparse", () => {
  it("flags a left-locked 28% form, not a centered or full-width one", async () => {
    await withPage(html, async (page) => {
      const narrow = await scanTableLayout(page);
      const hit = narrow.find((i) => i.rule === "sparse");
      assert.ok(hit, `expected sparse on the 28% form, got ${JSON.stringify(narrow)}`);
      assert.equal(hit.confidence, "high");
      assert.match(hit.message, /empty on the right/);

      await page.evaluate(() => {
        document.querySelector("form")!.className = "centered";
      });
      const centered = await scanTableLayout(page);
      assert.equal(
        centered.some((i) => i.rule === "sparse"),
        false,
        `centered form must not be sparse, got ${JSON.stringify(centered)}`,
      );

      await page.evaluate(() => {
        document.querySelector("form")!.className = "full";
      });
      const full = await scanTableLayout(page);
      assert.equal(
        full.some((i) => i.rule === "sparse"),
        false,
        `full-width form must not be sparse, got ${JSON.stringify(full)}`,
      );

      await page.evaluate(() => {
        document.querySelector("form")!.className = "half";
      });
      const half = await scanTableLayout(page);
      assert.ok(
        half.some((i) => i.rule === "sparse"),
        `expected sparse on the 50% form, got ${JSON.stringify(half)}`,
      );
    });
  });
});
