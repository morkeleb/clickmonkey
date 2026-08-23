import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scanBroken } from "../src/surveyor/broken.js";
import { withPage } from "./helpers/with-page.js";

const html = fileURLToPath(new URL("../fixtures/sites/broken-images/index.html", import.meta.url));

describe("scanBroken", () => {
  it("flags a visible missing image, not a decoded data URL or a hidden img", async () => {
    await withPage(html, async (page) => {
      const issues = await scanBroken(page);
      const logo = issues.find((i) => i.rule === "broken" && (i.where === "Logo" || /Logo/.test(i.message ?? "")));
      assert.ok(logo, `expected broken Logo, got ${JSON.stringify(issues)}`);
      assert.equal(logo.source, "visual");
      assert.equal(logo.severity, "error");
      assert.equal(logo.confidence, "high");
      assert.equal(logo.count, 1);
      assert.match(logo.message, /Image failed to decode/);
      assert.match(logo.message, /Logo/);

      const blob = JSON.stringify(issues);
      assert.equal(
        issues.some((i) => /Valid pixel/i.test(`${i.where} ${i.message}`)),
        false,
        `decoded data URL must not be broken, got ${blob}`,
      );
      assert.equal(
        issues.some((i) => /Hidden/i.test(`${i.where} ${i.message}`)),
        false,
        `hidden img must not be broken, got ${blob}`,
      );
      assert.equal(
        issues.some((i) => /Aria hole/i.test(`${i.where} ${i.message}`)),
        false,
        `aria-hidden img must not be broken, got ${blob}`,
      );
      assert.equal(
        issues.some((i) => /Empty src/i.test(`${i.where} ${i.message}`)),
        false,
        `empty src must not be broken, got ${blob}`,
      );
    });
  });
});
