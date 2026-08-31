import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scanTargetSize } from "../src/surveyor/target-size.js";
import { withPage } from "./helpers/with-page.js";

const html = fileURLToPath(new URL("../fixtures/sites/target-size/index.html", import.meta.url));

function blob(issues: Array<{ where?: string; message: string }>): string {
  return JSON.stringify(issues);
}

describe("scanTargetSize", () => {
  it("flags packed 16×16 toolbar icons, not a 40px button, inline link, or isolated icon", async () => {
    await withPage(html, async (page) => {
      const issues = await scanTargetSize(page);
      const hits = issues.filter((i) => i.rule === "targetSize");
      const dump = blob(hits);

      const icon = hits.find((i) => /icon-btn/.test(i.where ?? ""));
      assert.ok(icon, `expected packed 16×16 icon button, got ${dump}`);
      assert.equal(icon.source, "visual");
      assert.equal(icon.severity, "warning");
      assert.equal(icon.confidence, "high");
      assert.equal(icon.count, 1);
      assert.match(icon.message, /Button is 16×16px; WCAG 2\.5\.8 minimum is 24×24/);

      assert.ok(
        hits.some((i) => /icon-link/.test(i.where ?? "")),
        `expected packed 16×16 icon link, got ${dump}`,
      );

      assert.equal(
        hits.some((i) => /save/.test(`${i.where ?? ""} ${i.message}`)),
        false,
        `40px button must not be targetSize, got ${dump}`,
      );
      assert.equal(
        hits.some((i) => /inline-link/.test(`${i.where ?? ""} ${i.message}`)),
        false,
        `inline paragraph link must not be targetSize, got ${dump}`,
      );
      assert.equal(
        hits.some((i) => /lonely-icon/.test(i.where ?? "")),
        false,
        `isolated 16×16 with empty space must not be targetSize, got ${dump}`,
      );
      assert.equal(
        hits.some((i) =>
          /disabled-icon|aria-disabled-icon|ghost-icon|hidden-icon|collapsed-item|agree|bare-check/.test(i.where ?? ""),
        ),
        false,
        `disabled, hidden, collapsed, and native checkboxes must be skipped, got ${dump}`,
      );
      assert.equal(
        hits.some((i) => /native-select|tiny-close|Select is 1×1/i.test(`${i.where ?? ""} ${i.message}`)),
        false,
        `1×1 native select and Close are not pointer targets, got ${dump}`,
      );
    });
  });
});
