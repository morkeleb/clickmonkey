import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scanNoopener } from "../src/surveyor/noopener.js";
import { withPage } from "./helpers/with-page.js";

const html = fileURLToPath(new URL("../fixtures/sites/noopener/index.html", import.meta.url));

function blob(issues: Array<{ where?: string; message: string }>): string {
  return JSON.stringify(issues);
}

describe("scanNoopener", () => {
  it("flags a visible _blank link without rel, not noopener, noreferrer, same-tab, or hidden", async () => {
    await withPage(html, async (page) => {
      const issues = await scanNoopener(page);
      const hits = issues.filter((i) => i.rule === "noopener");
      const dump = blob(hits);

      const bare = hits.find((i) => /bare/.test(i.where ?? ""));
      assert.ok(bare, `expected bare _blank without rel, got ${dump}`);
      assert.equal(bare.source, "visual");
      assert.equal(bare.severity, "warning");
      assert.equal(bare.confidence, "high");
      assert.equal(bare.count, 1);
      assert.equal(bare.via, undefined);
      assert.match(bare.message, /Link opens a new tab without rel="noopener"/);

      assert.ok(hits.some((i) => /below/.test(i.where ?? "")), `below-the-fold _blank must still flag, got ${dump}`);
      assert.equal(
        hits.some((i) => /ok|referrer|same|hidden/.test(i.where ?? "")),
        false,
        `noopener, noreferrer, same-tab, and hidden must be skipped, got ${dump}`,
      );
      assert.ok(hits.length <= 8);
    });
  });

  it("treats <base target=_blank> as opening a new tab", async () => {
    await withPage(html, async (page) => {
      await page.evaluate(() => {
        const base = document.createElement("base");
        base.setAttribute("target", "_blank");
        document.head.appendChild(base);
      });
      const issues = await scanNoopener(page);
      const hits = issues.filter((i) => i.rule === "noopener");
      assert.ok(
        hits.some((i) => /same/.test(i.where ?? "")),
        `base target=_blank should flag a link with no target, got ${JSON.stringify(hits)}`,
      );
    });
  });
});
