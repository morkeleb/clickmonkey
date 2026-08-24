import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scanFocusVisible } from "../src/surveyor/focus-visible.js";
import { withPage } from "./helpers/with-page.js";

const html = fileURLToPath(new URL("../fixtures/sites/focus-visible/index.html", import.meta.url));

function blob(issues: Array<{ where?: string; message: string }>): string {
  return JSON.stringify(issues);
}

describe("scanFocusVisible", () => {
  it("flags a control with no focus ring, not one with a :focus-visible outline", async () => {
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
      const issues = await scanFocusVisible(page);
      const focused = (await page.evaluate("window.__focused || []")) as string[];
      assert.ok(focused.includes("bare"), `bare must be focused, got ${JSON.stringify(focused)}`);
      assert.ok(focused.includes("ok"), `ok must be focused, got ${JSON.stringify(focused)}`);
      assert.equal(focused.includes("skip"), false, `skip-link must not be focused, got ${JSON.stringify(focused)}`);
      assert.equal(
        focused.includes("disabled-bare"),
        false,
        `disabled must not be focused, got ${JSON.stringify(focused)}`,
      );
      assert.equal(focused.includes("agree"), false, `native checkbox must not be focused, got ${JSON.stringify(focused)}`);
      assert.equal(await page.evaluate(() => window.scrollY), yBefore);

      const hits = issues.filter((i) => i.rule === "focusVisible");
      const dump = blob(hits);

      const save = hits.find((i) => /Save/.test(`${i.where ?? ""} ${i.message}`));
      assert.ok(save, `expected Save with no focus ring, got ${dump}`);
      assert.equal(save.source, "visual");
      assert.equal(save.severity, "warning");
      assert.equal(save.confidence, "high");
      assert.equal(save.count, 1);
      assert.equal(save.via, undefined);
      assert.match(save.message, /Save has no visible focus indicator \(WCAG 2\.4\.7\)/);

      assert.equal(
        hits.some((i) => /Continue/.test(`${i.where ?? ""} ${i.message}`)),
        false,
        `Continue keeps a 2px outline on :focus-visible, got ${dump}`,
      );
      assert.equal(
        hits.some((i) => /Off|agree|Skip|disabled-bare/.test(`${i.where ?? ""} ${i.message}`)),
        false,
        `disabled, native checkbox, and skip-links must be skipped, got ${dump}`,
      );
    });
  });
});
