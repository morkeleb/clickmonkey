import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scanTableLayout } from "../src/surveyor/scanline.js";
import { withPage } from "./helpers/with-page.js";
import { fileURLToPath } from "node:url";

const html = fileURLToPath(new URL("../fixtures/sites/scanline/index.html", import.meta.url));

describe("scanTableLayout", () => {
  it("flags clipped table cells and ragged columns, not clean ellipsis", async () => {
    await withPage(html, async (page) => {
      const issues = await scanTableLayout(page);
      const clips = issues.filter((i) => i.rule === "clip");
      const lines = issues.filter((i) => i.rule === "scanline");
      assert.ok(
        clips.some((i) => /vendor/i.test(i.where ?? "") && /Ready-to-Pay/i.test(i.where ?? "")),
        `expected clipped vendor cells, got ${JSON.stringify(issues)}`,
      );
      assert.ok(
        clips.every((i) => !/Ellipsis ok/i.test(i.where ?? "")),
        "ellipsis truncation is not clip",
      );
      assert.ok(
        lines.some((i) => /vendor/i.test(i.where ?? "") && /Ragged titles/i.test(i.where ?? "")),
        `expected scanline on drifted vendor column, got ${JSON.stringify(issues)}`,
      );
      assert.ok(
        clips.some((i) => i.rule === "clip" && /due|field|UNION/i.test(`${i.where} ${i.message}`)),
        `expected clipped date field, got ${JSON.stringify(issues)}`,
      );
      assert.ok(clips.some((i) => i.confidence === "high"));
    });
  });
});
