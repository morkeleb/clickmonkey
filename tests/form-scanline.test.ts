import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scanFormScanline } from "../src/surveyor/form-scanline.js";
import { withPage } from "./helpers/with-page.js";

const html = fileURLToPath(new URL("../fixtures/sites/form-scanline/index.html", import.meta.url));

describe("scanFormScanline", () => {
  it("flags a dropped two-column field, a skewed side label, indented rows, and a ragged stacked column", async () => {
    await withPage(html, async (page) => {
      await page.setViewportSize({ width: 1280, height: 1800 });
      await page.locator("#create-journal").evaluate((el) => {
        if (el instanceof HTMLDialogElement) el.close();
      });
      const issues = await scanFormScanline(page);
      const lines = issues.filter((i) => i.rule === "scanline");
      const blob = JSON.stringify(lines);
      assert.ok(
        lines.some((i) => /Vendor Type and Legal Name sit on one row but do not line up/.test(i.message)),
        blob,
      );
      assert.ok(
        lines.some((i) => /Tax ID label does not line up with the field/.test(i.message)),
        blob,
      );
      assert.ok(
        lines.some((i) => /Attorney fields do not line up down the column/.test(i.message)),
        blob,
      );
      assert.ok(
        lines.some((i) => /Identity and Vendor Kind do not line up down the column/.test(i.message)),
        blob,
      );
      assert.ok(
        lines.every((i) => !/Invoice Date and Payment Terms sit on one row but do not line up/.test(i.message)),
        `inner input padding must not count as a dropped row, got ${blob}`,
      );
      assert.ok(
        lines.every((i) => !/Account Code and Cost Center sit on one row but do not line up/.test(i.message)),
        `MUI outlined chrome must share a top edge, got ${blob}`,
      );
      assert.ok(
        lines.some((i) => /Country and (Address type|Select address type) sit on one row but do not line up/.test(i.message)),
        blob,
      );
      assert.ok(
        lines.some((i) => /Display Name label does not line up with the field/.test(i.message)),
        blob,
      );
      assert.ok(
        lines.every((i) => !/Journal search|Journal status|From date|Posted date/.test(i.message)),
        `wrapped filter toolbar must not flag a top edge, got ${blob}`,
      );
      assert.ok(
        lines.every((i) => !/Default Payment Terms/.test(i.message) && !/Max Past Days/.test(i.message)),
        `fields in different cards must not flag a top edge, got ${blob}`,
      );
      assert.ok(
        lines.every((i) => !/Lock period/.test(i.message) && !/Hold days/.test(i.message)),
        `trust settings cards must not flag a top edge, got ${blob}`,
      );
      assert.ok(lines.every((i) => i.source === "visual" && i.via === undefined));
    });
  });

  it("does not flag page fields behind an open dialog", async () => {
    await withPage(html, async (page) => {
      const issues = await scanFormScanline(page);
      const lines = issues.filter((i) => i.rule === "scanline");
      const blob = JSON.stringify(lines);
      assert.ok(
        lines.every((i) => !/Journal search/.test(i.message) && !/Posted date/.test(i.message)),
        `page fields behind an open dialog must not flag, got ${blob}`,
      );
    });
  });
});
