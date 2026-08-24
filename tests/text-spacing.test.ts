import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scanTextSpacing } from "../src/surveyor/text-spacing.js";
import { withPage } from "./helpers/with-page.js";

const html = fileURLToPath(new URL("../fixtures/sites/text-spacing/index.html", import.meta.url));

function blob(issues: Array<{ where?: string; message: string; rule: string }>): string {
  return JSON.stringify(issues);
}

describe("scanTextSpacing", () => {
  it("flags a tight chip as textSpacing, not wrapping copy, and restores the sheet", async () => {
    await withPage(html, async (page) => {
      const issues = await scanTextSpacing(page);
      const hits = issues.filter((i) => i.rule === "textSpacing");
      const dump = blob(hits);

      const chip = hits.find((i) => /Project archive|tight-chip/i.test(`${i.where ?? ""} ${i.message}`));
      assert.ok(chip, `expected tight chip under WCAG 1.4.12 spacing, got ${dump}`);
      assert.equal(chip.source, "visual");
      assert.equal(chip.rule, "textSpacing");
      assert.match(chip.message, /text spacing|WCAG 1\.4\.12/i);
      assert.equal("via" in chip, false);

      assert.equal(
        hits.some((i) => /body-copy|ordinary body copy|reflow/i.test(`${i.where ?? ""} ${i.message}`)),
        false,
        `wrapping paragraph must not be textSpacing, got ${dump}`,
      );
      assert.equal(
        hits.some((i) => /roomy-btn|Save workspace/i.test(`${i.where ?? ""} ${i.message}`)),
        false,
        `roomy 40px button must not be textSpacing, got ${dump}`,
      );
      assert.ok(hits.length <= 8);

      const leftover = await page.evaluate(() => ({
        style: document.getElementById("cm-text-spacing"),
        cls: document.documentElement.classList.contains("cm-text-spacing"),
      }));
      assert.equal(leftover.style, null);
      assert.equal(leftover.cls, false);
    });
  });
});
