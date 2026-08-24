import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scanFocusObscured } from "../src/surveyor/focus-obscured.js";
import { withPage } from "./helpers/with-page.js";

const html = fileURLToPath(new URL("../fixtures/sites/focus-obscured/index.html", import.meta.url));

function blob(issues: Array<{ where?: string; message: string }>): string {
  return JSON.stringify(issues);
}

describe("scanFocusObscured", () => {
  it("flags a control entirely under the sticky header when focused, not a visible or partial one", async () => {
    await withPage(html, async (page) => {
      await page.evaluate(`(() => {
        window.__focused = [];
        var orig = HTMLElement.prototype.focus;
        HTMLElement.prototype.focus = function () {
          window.__focused.push(this.id);
          return orig.apply(this, arguments);
        };
      })()`);
      const yBefore = await page.evaluate(() => window.scrollY);
      const issues = await scanFocusObscured(page);
      const focused = (await page.evaluate("window.__focused || []")) as string[];
      assert.ok(focused.includes("below-fold"), `below-fold must be focused, got ${JSON.stringify(focused)}`);
      assert.equal(focused.includes("skip"), false, `skip-link must not be focused, got ${JSON.stringify(focused)}`);
      assert.equal(await page.evaluate(() => window.scrollY), yBefore);
      const hits = issues.filter((i) => i.rule === "focusObscured");
      const dump = blob(hits);

      const save = hits.find((i) => /Save/.test(`${i.where ?? ""} ${i.message}`));
      assert.ok(save, `expected Save under the sticky header, got ${dump}`);
      assert.equal(save.source, "visual");
      assert.equal(save.severity, "error");
      assert.equal(save.confidence, "high");
      assert.equal(save.count, 1);
      assert.match(save.message, /Save is entirely hidden by the sticky header when focused/);

      assert.equal(
        hits.some((i) => /Continue/.test(`${i.where ?? ""} ${i.message}`)),
        false,
        `Continue is fully below the header, got ${dump}`,
      );
      assert.equal(
        hits.some((i) => /Partial/.test(`${i.where ?? ""} ${i.message}`)),
        false,
        `partial cover is a pass (AA), got ${dump}`,
      );
      assert.equal(
        hits.some((i) => /Ghost|Off|aria-hidden-save|disabled-save|Skip|BelowFold/.test(`${i.where ?? ""} ${i.message}`)),
        false,
        `aria-hidden, disabled, skip-links, and a centered below-fold control must be skipped, got ${dump}`,
      );
    });
  });

  it("skips an open modal covering the page", async () => {
    await withPage(html, async (page) => {
      await page.evaluate(() => {
        document.getElementById("modal")!.classList.add("open");
      });
      const issues = await scanFocusObscured(page);
      const hits = issues.filter((i) => i.rule === "focusObscured");
      assert.equal(
        hits.some((i) => /Save|Continue|Partial/.test(`${i.where ?? ""} ${i.message}`)),
        false,
        `open dialog covering the page must skip, got ${JSON.stringify(hits)}`,
      );
      assert.equal(
        hits.some((i) => /OK|dialog-ok/.test(`${i.where ?? ""} ${i.message}`)),
        false,
        `dialog action must not be flagged as obscured, got ${JSON.stringify(hits)}`,
      );
    });
  });
});
