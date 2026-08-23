import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actableMissMessage,
  disabledControlHints,
  explainActableMiss,
  isLiveWidget,
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
      const story = actableMissMessage("page.button_save", "disabled", {
        waitSeconds: 15,
        fills: [{ ref: "page.defaultpaymentterms", value: "Net 45" }],
        hints: ["The form is visible; 8 of 10 fields look editable. Save itself is disabled (often until a change is registered), not hidden."],
      });
      assert.match(story, /^page\.button_save is disabled/);
      assert.match(story, /waited 15s/);
      assert.match(story, /page\.defaultpaymentterms/);
      assert.match(story, /Net 45/);
      assert.match(story, /look editable/);
      const hit = await pickActable(loc, page, { timeoutMs: 2_000 });
      assert.ok(hit);
      assert.equal(await hit.isEnabled(), true);
    });
  });

  it("lists a footer below the viewport as live and scrolls it for click", async () => {
    await withRun({}, async ({ page }) => {
      await page.setContent(`
        <div style="height: 2000px">pad</div>
        <button data-testid="wizard-next">Next</button>
      `);
      const loc = page.getByTestId("wizard-next");
      const box = await loc.boundingBox();
      const vp = page.viewportSize();
      assert.ok(box && vp);
      assert.ok(box.y > vp.height, "fixture must sit below the viewport");
      assert.equal(await isLiveWidget(loc, page), true);
      const hit = await pickActable(loc, page, { scroll: true });
      assert.ok(hit);
      const after = await hit.boundingBox();
      assert.ok(after);
      assert.ok(after.y + after.height > 0 && after.y < vp.height);
    });
  });

  it("does not call an editable settings form readonly just because Edit exists", async () => {
    await withRun({}, async ({ page }) => {
      await page.setContent(`
        <main>
          <input data-testid="terms" value="Net 45" />
          <button>Edit</button>
          <button data-testid="save" disabled>Save</button>
        </main>
      `);
      const hints = await disabledControlHints(page.getByTestId("save"), page);
      const blob = hints.join(" ");
      assert.match(blob, /look editable/);
      assert.doesNotMatch(blob, /read-only/i);
    });
  });
});
