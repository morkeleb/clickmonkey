import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actableMissMessage,
  explainActableMiss,
  pickActable,
} from "../src/executor/locators.js";
import { withRun } from "../src/executor/session.js";

describe("pickActable", () => {
  it("waits for a painted-but-disabled button to enable", async () => {
    await withRun({}, async ({ page }) => {
      await page.setContent(`
        <button data-testid="go" disabled>Sign In with Auth0</button>
        <script>
          setTimeout(() => {
            const el = document.querySelector("[data-testid=go]");
            if (el) el.disabled = false;
          }, 400);
        </script>
      `);
      const loc = page.getByTestId("go");
      assert.equal(await pickActable(loc, page), undefined);
      assert.equal(await explainActableMiss(loc, page), "disabled");
      assert.equal(actableMissMessage("page.go", "disabled"), "page.go is disabled");
      const hit = await pickActable(loc, page, { timeoutMs: 2_000 });
      assert.ok(hit);
      assert.equal(await hit.isEnabled(), true);
    });
  });
});
