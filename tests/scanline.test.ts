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
        clips.some(
          (i) =>
            /vendor/i.test(i.where ?? "") &&
            /Inner clip/i.test(i.where ?? "") &&
            /cut off \(no ellipsis\)/i.test(i.message),
        ),
        `expected inner-clipped vendor cells, got ${JSON.stringify(issues)}`,
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
      assert.ok(
        lines.some(
          (i) =>
            /Amount/i.test(i.where ?? "") &&
            /does not line up with the cells below it/i.test(i.message) &&
            /Line items/i.test(i.where ?? ""),
        ),
        `expected header-vs-cell scanline, got ${JSON.stringify(lines)}`,
      );
      assert.ok(
        lines.some(
          (i) =>
            /Amount/i.test(i.where ?? "") &&
            /does not line up with the cells below it/i.test(i.message) &&
            /Ink indent/i.test(i.where ?? ""),
        ),
        `expected header text indent vs cells, got ${JSON.stringify(lines)}`,
      );
      assert.ok(
        lines.every((i) => !/Distribution lines/i.test(i.where ?? "")),
        `editable grid header vs inputs is not scanline, got ${JSON.stringify(lines)}`,
      );
      assert.ok(
        clips.every(
          (i) =>
            !/cut off/i.test(i.message) || !/Distribution lines|Select account/i.test(i.where ?? ""),
        ),
        `editor overflow is not cell clip, got ${JSON.stringify(clips)}`,
      );
      assert.ok(
        lines.every((i) => !/Trial figures/i.test(i.where ?? "")),
        `right-locked amounts vs a left header are not scanline, got ${JSON.stringify(lines)}`,
      );
      assert.ok(
        clips.some(
          (i) =>
            /squished together/i.test(i.message) &&
            /BILLABLE/i.test(i.message) &&
            /DESCRIPTION/i.test(i.message) &&
            /Line item headers/i.test(i.where ?? ""),
        ),
        `expected squished BILLABLE/DESCRIPTION headers, got ${JSON.stringify(clips)}`,
      );
      assert.ok(
        clips.every((i) => !/Wrapped date header/i.test(i.where ?? "") || !/squished together/i.test(i.message)),
        `a header that wraps inside its column is not a collision, got ${JSON.stringify(clips)}`,
      );
    });
  });
});
