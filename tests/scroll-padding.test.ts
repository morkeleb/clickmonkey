import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scanScrollPadding } from "../src/surveyor/scroll-padding.js";
import { withPage } from "./helpers/with-page.js";

const html = fileURLToPath(new URL("../fixtures/sites/scroll-padding/index.html", import.meta.url));

function blob(issues: Array<{ where?: string; message: string }>): string {
  return JSON.stringify(issues);
}

describe("scanScrollPadding", () => {
  it("flags an 80px sticky header when scroll-padding-top is 0", async () => {
    await withPage(html, async (page) => {
      const issues = await scanScrollPadding(page);
      const hits = issues.filter((i) => i.rule === "scrollPadding");
      const dump = blob(hits);

      assert.equal(hits.length, 1, `expected one scrollPadding issue, got ${dump}`);
      const hit = hits[0]!;
      assert.equal(hit.source, "visual");
      assert.equal(hit.severity, "warning");
      assert.equal(hit.confidence, "high");
      assert.equal(hit.count, 1);
      assert.equal("via" in hit, false);
      assert.match(hit.where ?? "", /app-header/);
      assert.equal(hit.message, "Sticky header is 80px but scroll-padding-top is 0px");
      assert.equal(
        hits.some((i) => /static-header|side-nav/.test(i.where ?? "")),
        false,
        `static header and full-height side nav must not be the hit, got ${dump}`,
      );
    });
  });

  it("does not flag when html scroll-padding-top matches the header", async () => {
    await withPage(html, async (page) => {
      await page.evaluate(() => {
        document.documentElement.style.scrollPaddingTop = "80px";
      });
      const issues = await scanScrollPadding(page);
      assert.equal(
        issues.some((i) => i.rule === "scrollPadding"),
        false,
        `80px pad must not be scrollPadding, got ${JSON.stringify(issues)}`,
      );
    });
  });

  it("does not flag a static 80px header", async () => {
    await withPage(html, async (page) => {
      await page.evaluate(() => {
        const sticky = document.querySelector("header.sticky");
        if (sticky instanceof HTMLElement) sticky.style.display = "none";
      });
      const issues = await scanScrollPadding(page);
      assert.equal(
        issues.some((i) => i.rule === "scrollPadding"),
        false,
        `static header must not be scrollPadding, got ${JSON.stringify(issues)}`,
      );
    });
  });
});
