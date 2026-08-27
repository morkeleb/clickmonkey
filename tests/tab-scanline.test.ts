import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scanTabScanline } from "../src/surveyor/tab-scanline.js";
import { withPage } from "./helpers/with-page.js";

const html = fileURLToPath(new URL("../fixtures/sites/tab-scanline/index.html", import.meta.url));

describe("scanTabScanline", () => {
  it("flags a stepped tab title, not a menubar, overflow menu, or aligned sidebar", async () => {
    await withPage(html, async (page) => {
      const issues = await scanTabScanline(page);
      const lines = issues.filter((i) => i.rule === "scanline");
      assert.ok(
        lines.some(
          (i) =>
            i.message === "Tab titles do not share a left edge" &&
            /statement/i.test(i.where ?? ""),
        ),
        `expected scanline on stepped tab titles, got ${JSON.stringify(issues)}`,
      );
      assert.ok(
        lines.some((i) => i.confidence === "high"),
        `expected high confidence on 40px title drift, got ${JSON.stringify(issues)}`,
      );
      assert.ok(
        lines.every((i) => i.source === "visual" && i.severity === "warning" && i.count === 1),
      );
      assert.ok(
        lines.every((i) => !/sidebar/i.test(`${i.where} ${i.message}`)),
        `aligned vertical tabs must not be scanline, got ${JSON.stringify(issues)}`,
      );
      assert.ok(
        lines.every((i) => !/overflow|primary|menu/i.test(`${i.where} ${i.message}`)),
        `menubar and overflow menu must not be scanline, got ${JSON.stringify(issues)}`,
      );
    });
  });
});
