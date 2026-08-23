import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { scanOverflow } from "../src/surveyor/overflow.js";
import { withPage } from "./helpers/with-page.js";

const html = fileURLToPath(new URL("../fixtures/sites/overflow/index.html", import.meta.url));

function setCase(page: Page, className: string) {
  return page.evaluate((cls) => {
    document.getElementById("case")!.className = cls;
  }, className);
}

describe("scanOverflow", () => {
  it("flags a 1400px block and 100vw in padded main, not a scroll wrap or centered card", async () => {
    await withPage(html, async (page) => {
      const wide = await scanOverflow(page);
      const hit = wide.find((i) => i.rule === "overflow");
      assert.ok(hit, `expected overflow on the 1400px block, got ${JSON.stringify(wide)}`);
      assert.equal(hit.confidence, "high");
      assert.equal(hit.severity, "error");
      assert.match(hit.message, /wider than the viewport|extends \d+px/);
      assert.match(hit.where ?? "", /hero/i);

      await setCase(page, "vw");
      const vwCase = await scanOverflow(page);
      const vwHit = vwCase.find((i) => i.rule === "overflow");
      assert.ok(vwHit, `expected overflow on 100vw in padded main, got ${JSON.stringify(vwCase)}`);

      await setCase(page, "scroll-wrap");
      const scroll = await scanOverflow(page);
      assert.equal(
        scroll.some((i) => i.rule === "overflow"),
        false,
        `overflow-x:auto table wrap must not count, got ${JSON.stringify(scroll)}`,
      );

      await setCase(page, "card");
      const card = await scanOverflow(page);
      assert.equal(
        card.some((i) => i.rule === "overflow"),
        false,
        `centered card that fits must not count, got ${JSON.stringify(card)}`,
      );

      await setCase(page, "leak");
      const leak = await scanOverflow(page);
      const leakHit = leak.find((i) => i.rule === "overflow");
      assert.ok(leakHit, `expected container overflow on the leak card, got ${JSON.stringify(leak)}`);
      assert.equal(leakHit.confidence, "medium");
      assert.match(leakHit.message, /extends \d+px past/);

      await page.evaluate(() => {
        (document.getElementById("help") as HTMLDialogElement).showModal();
      });
      const withDialog = await scanOverflow(page);
      const dlgHit = withDialog.find((i) => i.rule === "overflow");
      assert.ok(dlgHit, `small dialog should not hide the leak, got ${JSON.stringify(withDialog)}`);
      assert.equal(/help|dialog/i.test(dlgHit.where ?? ""), false);
    });
  });
});
