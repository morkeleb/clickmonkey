import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scanA11y } from "../src/surveyor/a11y.js";
import { withPage } from "./helpers/with-page.js";

const html = fileURLToPath(new URL("../fixtures/sites/a11y-extra/index.html", import.meta.url));

function blob(issues: Array<{ rule: string; where?: string; message: string }>): string {
  return JSON.stringify(issues);
}

describe("scanA11y extra rules", () => {
  it("flags the extra allowlist without tagging a tabindex=0 button, and still runs wcag2a", async () => {
    await withPage(html, async (page) => {
      const issues = await scanA11y(page);
      const dump = blob(issues);
      const rules = issues.map((i) => i.rule);

      for (const rule of [
        "tabindex",
        "empty-heading",
        "heading-order",
        "skip-link",
        "label-title-only",
        "aria-dialog-name",
        "label-content-name-mismatch",
        "button-name",
      ] as const) {
        assert.ok(rules.includes(rule), `expected ${rule}, got ${dump}`);
      }

      const tabindex = issues.find((i) => i.rule === "tabindex");
      assert.ok(/high-tabindex/.test(tabindex?.where ?? ""), `tabindex where, got ${dump}`);
      assert.equal(
        /ok-btn/.test(tabindex?.where ?? ""),
        false,
        `tabindex=0 button must not be flagged, got ${dump}`,
      );

      assert.ok(/empty-h2/.test(issues.find((i) => i.rule === "empty-heading")?.where ?? ""), dump);
      assert.ok(/skip-h3/.test(issues.find((i) => i.rule === "heading-order")?.where ?? ""), dump);
      assert.ok(/skip-link/.test(issues.find((i) => i.rule === "skip-link")?.where ?? ""), dump);
      assert.ok(/title-only/.test(issues.find((i) => i.rule === "label-title-only")?.where ?? ""), dump);
      assert.ok(/unnamed-dialog/.test(issues.find((i) => i.rule === "aria-dialog-name")?.where ?? ""), dump);
      assert.ok(/name-mismatch/.test(issues.find((i) => i.rule === "label-content-name-mismatch")?.where ?? ""), dump);
      assert.ok(/unnamed-btn/.test(issues.find((i) => i.rule === "button-name")?.where ?? ""), dump);

      assert.equal(rules.includes("region"), false, `region must stay off, got ${dump}`);
      assert.equal(rules.includes("landmark-one-main"), false, `landmarks must stay off, got ${dump}`);
    });
  });
});
