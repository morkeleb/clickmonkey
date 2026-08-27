import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scanTextOcclusion } from "../src/surveyor/text-occlusion.js";
import { withPage } from "./helpers/with-page.js";

const html = fileURLToPath(new URL("../fixtures/sites/text-occlusion/index.html", import.meta.url));

describe("scanTextOcclusion", () => {
  it("flags an h1 covered by an opaque sibling, not a corner badge or button text", async () => {
    await withPage(html, async (page) => {
      const issues = await scanTextOcclusion(page);
      const hits = issues.filter((i) => i.rule === "textOcclusion");
      const dump = JSON.stringify(issues);

      const covered = hits.find((i) => /Quarterly revenue/i.test(`${i.where} ${i.message}`));
      assert.ok(covered, `expected covered heading, got ${dump}`);
      assert.equal(covered.source, "visual");
      assert.equal(covered.severity, "warning");
      assert.equal(covered.confidence, "high");
      assert.equal(covered.count, 1);
      assert.match(covered.message, /Heading is covered by a badge/);

      assert.equal(
        hits.some((i) => /forecasts|corner/i.test(`${i.where} ${i.message}`)),
        false,
        `corner badge on a long heading must not count, got ${dump}`,
      );
      assert.equal(
        hits.some((i) => /^Save$/i.test(i.where ?? "") || /Save is covered/i.test(i.message)),
        false,
        `text inside a button is a descendant, got ${dump}`,
      );
      assert.equal(
        hits.some((i) => /Clipped overflow/i.test(`${i.where} ${i.message}`)),
        false,
        `overflow:hidden clip is not textOcclusion, got ${dump}`,
      );
      assert.ok(hits.length <= 8);
    });
  });

  it("skips chrome behind an open dialog covering the page", async () => {
    await withPage(html, async (page) => {
      await page.evaluate(() => {
        document.getElementById("modal")!.classList.add("open");
      });
      const issues = await scanTextOcclusion(page);
      assert.equal(
        issues.some(
          (i) =>
            i.rule === "textOcclusion" && /Behind|Body copy/i.test(`${i.where} ${i.message}`),
        ),
        false,
        `open dialog covering the page must skip, got ${JSON.stringify(issues)}`,
      );
    });
  });

  it("skips a menu overlay, tab chrome on another panel, and a stepper over a heading", async () => {
    await withPage(html, async (page) => {
      const issues = await scanTextOcclusion(page);
      const hits = issues.filter((i) => i.rule === "textOcclusion");
      const dump = JSON.stringify(issues);

      assert.equal(
        hits.some((i) => /TOTAL|fvs-menu-surface/i.test(`${i.where} ${i.message}`)),
        false,
        `menu-surface covering a cell must skip, got ${dump}`,
      );
      assert.equal(
        hits.some((i) => /fvs-tab|tablist/i.test(`${i.where} ${i.message}`)),
        false,
        `tab chrome covering another panel must skip, got ${dump}`,
      );
      assert.equal(
        hits.some((i) => /Code|Description|Active/.test(`${i.where} ${i.message}`) && /tab/i.test(i.message)),
        false,
        `unselected tabpanel cells must skip, got ${dump}`,
      );
      assert.equal(
        hits.some((i) => /Project heading/i.test(`${i.where} ${i.message}`)),
        false,
        `stepper step covering a heading must skip, got ${dump}`,
      );

      const covered = hits.find((i) => /Quarterly revenue/i.test(`${i.where} ${i.message}`));
      assert.ok(covered, `opaque badge cover must still file, got ${dump}`);
    });
  });
});
