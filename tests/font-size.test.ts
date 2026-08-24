import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scanFontSize } from "../src/surveyor/font-size.js";
import { withPage } from "./helpers/with-page.js";

const html = fileURLToPath(new URL("../fixtures/sites/font-size/index.html", import.meta.url));

function blob(issues: Array<{ where?: string; message: string }>): string {
  return JSON.stringify(issues);
}

describe("scanFontSize", () => {
  it("flags a 9px paragraph in main, not 16px copy, 11px code, or 11px nav", async () => {
    await withPage(html, async (page) => {
      const issues = await scanFontSize(page);
      const hits = issues.filter((i) => i.rule === "fontSize");
      const dump = blob(hits);

      const tiny = hits.find((i) => /tiny-copy/.test(i.where ?? ""));
      assert.ok(tiny, `expected 9px body copy, got ${dump}`);
      assert.equal(tiny.source, "visual");
      assert.equal(tiny.severity, "warning");
      assert.equal(tiny.confidence, "high");
      assert.equal(tiny.count, 1);
      assert.match(tiny.message, /Body text is 9px; keep body copy at least 12px/);

      assert.equal(
        hits.some((i) => /ok-copy/.test(`${i.where ?? ""} ${i.message}`)),
        false,
        `16px paragraph must not be fontSize, got ${dump}`,
      );
      assert.equal(
        hits.some((i) =>
          /tiny-code|nav-tiny|aside-tiny|footer-tiny|hidden-tiny|aria-hidden-tiny|inert-tiny|empty-tiny|tiny-btn/.test(
            i.where ?? "",
          ),
        ),
        false,
        `code, nav/aside/footer chrome, hidden, inert, empty text, and tiny buttons must be skipped, got ${dump}`,
      );
      assert.ok(hits.length <= 8);
    });
  });
});
