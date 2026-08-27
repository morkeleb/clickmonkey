import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Page } from "playwright";
import { scanOverflow, scanOverflowMobile, scanOverflowReflow } from "../src/surveyor/overflow.js";
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

describe("scanOverflowMobile", () => {
  it("flags a min-width:400px block at 375px and restores the 1280 viewport", async () => {
    await withPage(html, async (page) => {
      await setCase(page, "phone");
      const desktop = await scanOverflow(page);
      assert.equal(
        desktop.some((i) => i.rule === "overflow"),
        false,
        `min-width 400px must fit at 1280, got ${JSON.stringify(desktop)}`,
      );

      const mobile = await scanOverflowMobile(page);
      const hit = mobile.find((i) => i.rule === "overflow");
      assert.ok(hit, `expected overflow at 375px, got ${JSON.stringify(mobile)}`);
      assert.match(hit.where ?? hit.message, /@ 375px/);
      assert.equal(page.viewportSize()?.width, 1280);
    });
  });
});

describe("scanOverflow overlay skip", () => {
  it("does not treat a card-sized dialog as the page at 320 or 375", async () => {
    await withPage(html, async (page) => {
      await setCase(page, "fit");
      await page.evaluate(() => {
        document.getElementById("phone-dialog")!.classList.add("open");
      });
      const reflow = await scanOverflowReflow(page);
      assert.equal(
        reflow.some((i) => i.rule === "overflow"),
        false,
        `card-sized dialog at 320 is an overlay, got ${JSON.stringify(reflow)}`,
      );
      const mobile = await scanOverflowMobile(page);
      assert.equal(
        mobile.some((i) => i.rule === "overflow"),
        false,
        `card-sized dialog at 375 is an overlay, got ${JSON.stringify(mobile)}`,
      );
    });
  });

  it("does not file a scrim/backdrop or an open menu-surface dropdown", async () => {
    await withPage(html, async (page) => {
      await setCase(page, "fit");
      await page.evaluate(() => {
        document.getElementById("skrim-demo")!.classList.add("open");
      });
      const skrim = await scanOverflow(page);
      assert.equal(
        skrim.some((i) => i.rule === "overflow"),
        false,
        `scrim/backdrop is not page overflow, got ${JSON.stringify(skrim)}`,
      );

      await page.evaluate(() => {
        document.getElementById("skrim-demo")!.classList.remove("open");
        document.getElementById("menu-demo")!.classList.add("open");
      });
      const menu = await scanOverflow(page);
      assert.equal(
        menu.some((i) => i.rule === "overflow"),
        false,
        `open menu-surface is not page overflow, got ${JSON.stringify(menu)}`,
      );
    });
  });
});

describe("scanOverflowReflow", () => {
  it("flags a min-width:340px block at 320px, not at 1280 or 375, and restores the 1280 viewport", async () => {
    await withPage(html, async (page) => {
      await setCase(page, "reflow");
      const desktop = await scanOverflow(page);
      assert.equal(
        desktop.some((i) => i.rule === "overflow"),
        false,
        `min-width 340px must fit at 1280, got ${JSON.stringify(desktop)}`,
      );

      const mobile = await scanOverflowMobile(page);
      assert.equal(
        mobile.some((i) => i.rule === "overflow"),
        false,
        `min-width 340px must fit at 375, got ${JSON.stringify(mobile)}`,
      );

      const reflow = await scanOverflowReflow(page);
      const hit = reflow.find((i) => i.rule === "overflow");
      assert.ok(hit, `expected overflow at 320px, got ${JSON.stringify(reflow)}`);
      assert.match(hit.where ?? hit.message, /@ 320px/);
      assert.equal(hit.confidence, "high");
      assert.equal(hit.severity, "error");
      assert.equal(page.viewportSize()?.width, 1280);
    });
  });
});
