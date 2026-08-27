import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scanFormTab } from "../src/surveyor/form-tab.js";
import { withPage } from "./helpers/with-page.ts";

const trap = fileURLToPath(new URL("../fixtures/sites/keyboard-trap/index.html", import.meta.url));
const order = fileURLToPath(new URL("../fixtures/sites/focus-order/index.html", import.meta.url));
const ok = fileURLToPath(new URL("../fixtures/sites/form-tab/index.html", import.meta.url));

describe("scanFormTab", () => {
  it("flags a widget that swallows Tab", async () => {
    await withPage(trap, async (page) => {
      const issues = await scanFormTab(page);
      const hit = issues.find((i) => i.rule === "keyboardTrap");
      assert.ok(hit, `expected keyboardTrap, got ${JSON.stringify(issues)}`);
      assert.match(hit.message, /2\.1\.2/);
      assert.equal(hit.confidence, "high");
    });
  });

  it("flags a form whose Tab order runs up the column", async () => {
    await withPage(order, async (page) => {
      const issues = await scanFormTab(page);
      const hit = issues.find((i) => i.rule === "focusOrder");
      assert.ok(hit, `expected focusOrder, got ${JSON.stringify(issues)}`);
      assert.match(hit.message, /2\.4\.3/);
    });
  });

  it("leaves a top-to-bottom form alone", async () => {
    await withPage(ok, async (page) => {
      const issues = await scanFormTab(page);
      assert.deepEqual(issues, []);
    });
  });
});
