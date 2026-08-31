import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scanTextClip } from "../src/surveyor/text-clip.js";
import { withPage } from "./helpers/with-page.js";

const html = fileURLToPath(new URL("../fixtures/sites/text-clip/index.html", import.meta.url));

describe("scanTextClip", () => {
  it("flags a clipped tab title, not ellipsis, scroll, table cells, or open menus", async () => {
    await withPage(html, async (page) => {
      const issues = await scanTextClip(page);
      const clips = issues.filter((i) => i.rule === "clip");
      assert.ok(
        clips.some(
          (i) =>
            /tab title/i.test(i.message) &&
            /Accounts receivable/i.test(i.where ?? "") &&
            i.severity === "error" &&
            i.source === "visual",
        ),
        `expected clipped tab, got ${JSON.stringify(issues)}`,
      );
      assert.ok(
        clips.some((i) => /Accounts receivable/i.test(i.where ?? "") && i.confidence === "high"),
        `expected high confidence on a 72px tab, got ${JSON.stringify(issues)}`,
      );
      assert.ok(
        clips.every((i) => !/Vendor statements/i.test(i.where ?? "")),
        "ellipsis truncation is not clip",
      );
      assert.ok(
        clips.every((i) => !/purchase orders/i.test(i.where ?? "")),
        "overflow-x auto/scroll is not clip",
      );
      assert.ok(
        clips.every((i) => !/Expert Witness|Ready-to-Pay/i.test(`${i.where} ${i.message}`)),
        `table cells belong to scanline, got ${JSON.stringify(issues)}`,
      );
      assert.ok(
        clips.every((i) => !/vendor credits/i.test(i.where ?? "")),
        "open menu menuitems are skipped",
      );
      assert.ok(
        clips.every((i) => !/^Save$/i.test(i.where ?? "")),
        "roomy controls are not clip",
      );
      assert.ok(clips.length <= 8);
    });
  });

  it("skips collapsed icon-rail button labels", async () => {
    await withPage(html, async (page) => {
      const issues = await scanTextClip(page);
      const clips = issues.filter((i) => i.rule === "clip");
      assert.ok(
        clips.every((i) => !/Overview|Customers|Orchestration/i.test(i.where ?? "")),
        `icon-rail labels must not be clip, got ${JSON.stringify(issues)}`,
      );
      assert.ok(
        clips.some((i) => /Accounts receivable/i.test(i.where ?? "")),
        `clipped tab must still file, got ${JSON.stringify(issues)}`,
      );
    });
  });

  it("skips chrome behind a small open dialog and still flags clip inside it", async () => {
    await withPage(html, async (page) => {
      await page.evaluate(() => {
        const dlg = document.createElement("div");
        dlg.setAttribute("role", "dialog");
        dlg.setAttribute("aria-label", "Filters");
        dlg.style.cssText =
          "position:fixed;left:40px;top:40px;width:360px;height:240px;background:#fff;border:1px solid #333;z-index:20;padding:12px;box-sizing:border-box;";
        const tab = document.createElement("div");
        tab.setAttribute("role", "tab");
        tab.className = "cut";
        tab.textContent = "Unapplied cash receipts";
        dlg.appendChild(tab);
        document.body.appendChild(dlg);
      });
      const issues = await scanTextClip(page);
      const clips = issues.filter((i) => i.rule === "clip");
      assert.ok(
        clips.some((i) => /Unapplied cash/i.test(i.where ?? "")),
        `expected clip inside the dialog, got ${JSON.stringify(issues)}`,
      );
      assert.ok(
        clips.every((i) => !/Accounts receivable/i.test(i.where ?? "")),
        `chrome behind a small dialog must not be clip, got ${JSON.stringify(issues)}`,
      );
    });
  });
});
