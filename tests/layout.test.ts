import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scanLayout } from "../src/surveyor/layout.js";
import { withPage } from "./helpers/with-page.js";

const sparse = fileURLToPath(new URL("../fixtures/sites/sparse/index.html", import.meta.url));
const overflow = fileURLToPath(new URL("../fixtures/sites/overflow/index.html", import.meta.url));
const broken = fileURLToPath(new URL("../fixtures/sites/broken-images/index.html", import.meta.url));

describe("scanLayout", () => {
  it("runs sparse, overflow, and broken together", async () => {
    await withPage(sparse, async (page) => {
      const issues = (await scanLayout(page)).issues;
      assert.ok(
        issues.some((i) => i.rule === "sparse"),
        `expected sparse, got ${JSON.stringify(issues.map((i) => i.rule))}`,
      );
    });
    await withPage(overflow, async (page) => {
      await page.evaluate(() => {
        document.body.style.minHeight = "2000px";
        window.scrollTo(0, 80);
      });
      const before = await page.evaluate(() => ({
        y: window.scrollY,
        w: window.innerWidth,
      }));
      assert.ok(before.y >= 80, `need a scrolled page, got y=${before.y}`);
      const issues = (await scanLayout(page)).issues;
      assert.ok(
        issues.some((i) => i.rule === "overflow"),
        `expected overflow, got ${JSON.stringify(issues.map((i) => i.rule))}`,
      );
      assert.equal(
        issues.some((i) => i.rule === "textSpacing"),
        false,
        `1400px leak must not also be textSpacing, got ${JSON.stringify(issues.filter((i) => i.rule === "textSpacing"))}`,
      );
      assert.ok(issues.every((i) => i.via === "dom"));
      assert.equal(page.viewportSize()?.width, 1280);
      const after = await page.evaluate(() => ({ y: window.scrollY, w: window.innerWidth }));
      assert.equal(after.w, before.w);
      assert.equal(after.y, before.y);
    });
    await withPage(broken, async (page) => {
      const issues = (await scanLayout(page)).issues;
      assert.ok(
        issues.some((i) => i.rule === "broken"),
        `expected broken, got ${JSON.stringify(issues.map((i) => i.rule))}`,
      );
    });
  });
});
