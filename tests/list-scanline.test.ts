import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scanListScanline } from "../src/surveyor/list-scanline.js";
import { withPage } from "./helpers/with-page.js";

const html = fileURLToPath(new URL("../fixtures/sites/list-scanline/index.html", import.meta.url));

describe("scanListScanline", () => {
  it("flags ragged list titles and width-shifted card values, not a 3-col grid or locked amounts", async () => {
    await withPage(html, async (page) => {
      const issues = await scanListScanline(page);
      const lines = issues.filter((i) => i.rule === "scanline");
      assert.ok(
        lines.some(
          (i) =>
            i.message === "Row titles do not share a left edge" &&
            /thread/i.test(i.where ?? ""),
        ),
        `expected scanline on list titles, got ${JSON.stringify(issues)}`,
      );
      assert.ok(
        lines.some(
          (i) =>
            i.message === "Row values do not share a left edge" &&
            /voucher/i.test(i.where ?? ""),
        ),
        `expected scanline when title width shoves card amounts, got ${JSON.stringify(issues)}`,
      );
      assert.ok(
        lines.some((i) => i.confidence === "high"),
        `expected high confidence on 40px title drift, got ${JSON.stringify(issues)}`,
      );
      assert.ok(
        lines.every((i) => i.source === "visual" && i.severity === "warning" && i.count === 1),
      );
      assert.ok(
        lines.every((i) => !/Ragged titles|vendor|drift/i.test(`${i.where} ${i.message}`)),
        `tables are owned by scanTableLayout, got ${JSON.stringify(issues)}`,
      );
      assert.ok(
        lines.every((i) => (i.where ?? "") !== "cards"),
        `3-col cards must not be scanline, got ${JSON.stringify(issues)}`,
      );
      assert.ok(
        lines.every((i) => !/locked/i.test(`${i.where} ${i.message}`)),
        `right-locked amounts are a column, got ${JSON.stringify(issues)}`,
      );
      assert.ok(
        lines.every((i) => !/overflow|primary|menu|app nav|shortcut/i.test(`${i.where} ${i.message}`)),
        `menubar, overflow menu, and shortcut-rail ⌘K must not be scanline, got ${JSON.stringify(issues)}`,
      );
    });
  });
});
