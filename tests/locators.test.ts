import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actableMissMessage,
  disabledControlHints,
  explainActableMiss,
  isLiveWidget,
  pickActable,
  toPlaywrightLocator,
} from "../src/executor/locators.js";
import { widgetIsCovered } from "../src/executor/look.js";
import {
  clickFailureMessage,
  closeOpenOverlays,
  describeClickHit,
  dismissLeftoverMenuCover,
} from "../src/executor/click-hit.js";
import { withRun } from "../src/executor/session.js";

describe("toPlaywrightLocator", () => {
  it("matches Active tabs by prefix when nameExact is false", async () => {
    await withRun({}, async ({ page }) => {
      await page.setContent(`<button aria-label="Active tabs: 12">tabs</button>`);
      const prefix = toPlaywrightLocator(page, {
        by: "role",
        value: "button",
        name: "Active tabs",
        nameExact: false,
      });
      assert.equal(await prefix.count(), 1);
      assert.equal(await prefix.getAttribute("aria-label"), "Active tabs: 12");
      const exact = toPlaywrightLocator(page, {
        by: "role",
        value: "button",
        name: "Active tabs",
      });
      assert.equal(await exact.count(), 0);
    });
  });
});

describe("pickActable", () => {
  it("does not wait when the control is missing from the DOM", async () => {
    await withRun({}, async ({ page }) => {
      await page.setContent(`<button data-testid="go">Go</button>`);
      const loc = page.getByTestId("nope");
      const t0 = Date.now();
      assert.equal(await pickActable(loc, page, { timeoutMs: 5_000 }), undefined);
      assert.ok(Date.now() - t0 < 800, "missing widgets must not sit on --timeout");
      assert.equal(await explainActableMiss(loc, page), "missing");
    });
  });

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

  it("does not treat a custom select trigger as covering the native field", async () => {
    await withRun({}, async ({ page }) => {
      await page.setContent(`
        <style>
          .wrap { position: relative; width: 240px; height: 40px; }
          select { width: 240px; height: 40px; opacity: 0; }
          .wrap button { position: absolute; inset: 0; }
        </style>
        <div class="wrap">
          <select data-testid="terms">
            <option>Net 15</option>
            <option>Net 30</option>
          </select>
          <button type="button">Net 15</button>
        </div>
      `);
      const loc = page.getByTestId("terms");
      assert.equal(await widgetIsCovered(loc), false);
      const hit = await pickActable(loc, page, { scroll: true });
      assert.ok(hit);
    });
  });

  it("does not pick a control covered by an open menu", async () => {
    await withRun({}, async ({ page }) => {
      await page.setContent(`
        <button data-testid="cash">Cash Flow</button>
        <div role="menu" aria-label="Account menu" style="position:fixed;inset:0;z-index:20;background:#fff">
          <button type="button">Sign Out</button>
        </div>
      `);
      const loc = page.getByTestId("cash");
      assert.equal(await pickActable(loc, page, { scroll: true }), undefined);
      assert.equal(await explainActableMiss(loc, page), "covered");
      await page.evaluate(`document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") document.querySelector("[role=menu]")?.remove();
      })`);
      assert.equal(await dismissLeftoverMenuCover(loc, page), true);
      const hit = await pickActable(loc, page, { scroll: true });
      assert.ok(hit);
      assert.equal(await hit.getAttribute("data-testid"), "cash");
    });
  });

  it("closes a painted option popover that has no listbox role", async () => {
    await withRun({}, async ({ page }) => {
      await page.setContent(`
        <button data-testid="pay">Payment method</button>
        <div data-testid="type-pop" style="position:fixed;left:40px;top:80px;z-index:20;background:#fff;padding:8px">
          <div role="option">Court</div>
          <div role="option">Medical Record Retrieval Service</div>
        </div>
      `);
      await page.evaluate(`document.addEventListener("click", () => {
        document.querySelector("[data-testid=type-pop]")?.remove();
      }, true)`);
      await closeOpenOverlays(page, page.getByRole("option").first());
      assert.equal(await page.getByTestId("type-pop").count(), 0);
      const hit = await pickActable(page.getByTestId("pay"), page, { scroll: true });
      assert.ok(hit);
    });
  });

  it("dismisses a leftover typeahead button covering the next field", async () => {
    await withRun({}, async ({ page }) => {
      await page.setContent(`
        <div role="tablist" style="position:fixed;top:0;left:0;right:0;height:40px">
          <button role="tab" data-testid="settings-tab">Settings</button>
        </div>
        <input data-testid="next" placeholder="Select attorney" style="position:fixed;left:40px;top:200px;width:280px;height:32px" />
        <button type="button" data-testid="leftover" style="position:fixed;left:40px;top:200px;width:280px;height:32px;z-index:20">Hannah Kim</button>
        <script>
          document.querySelector("[data-testid=settings-tab]").addEventListener("click", () => {
            document.body.dataset.tab = "hit";
          });
          document.querySelector("[data-testid=leftover]").addEventListener("click", () => {
            document.body.dataset.picked = "hit";
          });
          document.addEventListener("mousedown", (e) => {
            const leftover = document.querySelector("[data-testid=leftover]");
            if (leftover && !leftover.contains(e.target)) leftover.remove();
          });
        </script>
      `);
      const loc = page.getByTestId("next");
      assert.equal(await explainActableMiss(loc, page), "covered");
      assert.equal(await dismissLeftoverMenuCover(loc, page), true);
      assert.equal(await page.getByTestId("leftover").count(), 0);
      assert.notEqual(await page.evaluate("document.body.dataset.tab"), "hit");
      assert.notEqual(await page.evaluate("document.body.dataset.picked"), "hit");
      const hit = await pickActable(loc, page, { scroll: true });
      assert.ok(hit);
    });
  });

  it("does not click workspace tabs when dismissing a picker", async () => {
    await withRun({}, async ({ page }) => {
      await page.setContent(`
        <div role="tablist" style="position:fixed;top:0;left:0;right:0;height:40px">
          <button role="tab" data-testid="settings-tab">Settings</button>
        </div>
        <div data-testid="type-pop" style="position:fixed;left:40px;top:80px;z-index:20;background:#fff;padding:8px">
          <div role="option">Court</div>
        </div>
        <script>
          document.querySelector("[data-testid=settings-tab]").addEventListener("click", () => {
            document.body.dataset.tab = "hit";
          });
        </script>
      `);
      await closeOpenOverlays(page, page.getByRole("option").first());
      assert.notEqual(await page.evaluate("document.body.dataset.tab"), "hit");
    });
  });

  it("names the overlay the click actually hit", async () => {
    await withRun({}, async ({ page }) => {
      await page.setContent(`
        <button data-testid="cash">Cash Flow</button>
        <div role="menu" aria-label="Account menu" style="position:fixed;inset:0;z-index:20;background:#fff">
          <button type="button">Sign Out</button>
        </div>
      `);
      const loc = page.getByTestId("cash");
      const hit = await describeClickHit(loc, page);
      assert.match(hit ?? "", /Sign Out|Account menu/i);
      const err = `locator.click: Timeout 2000ms exceeded.
Call log:
  - <html lang="en"> intercepts pointer events
`;
      assert.match(
        clickFailureMessage({ widgetKey: "page.button_cash", error: err, hit }),
        /page\.button_cash click hit .+ instead of the control/,
      );
      assert.doesNotMatch(
        clickFailureMessage({ widgetKey: "page.button_cash", error: err, hit }),
        /Timeout 2000ms exceeded/,
      );
    });
  });
});
