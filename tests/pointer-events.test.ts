import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scanPointerEvents } from "../src/surveyor/pointer-events.js";
import { withPage } from "./helpers/with-page.js";

const html = fileURLToPath(new URL("../fixtures/sites/pointer-events/index.html", import.meta.url));

function blob(issues: Array<{ where?: string; message: string }>): string {
  return JSON.stringify(issues);
}

describe("scanPointerEvents", () => {
  it("flags a shown enabled control with pointer-events none, not auto or skipped ones", async () => {
    await withPage(html, async (page) => {
      const issues = await scanPointerEvents(page);
      const hits = issues.filter((i) => i.rule === "pointerEvents");
      const dump = blob(hits);

      const save = hits.find((i) => /Save/.test(`${i.where ?? ""} ${i.message}`));
      assert.ok(save, `expected Save with pointer-events none, got ${dump}`);
      assert.equal(save.source, "visual");
      assert.equal(save.severity, "error");
      assert.equal(save.confidence, "high");
      assert.equal(save.count, 1);
      assert.equal(save.via, undefined);
      assert.match(save.where ?? "", /dead/);
      assert.match(save.message, /Save ignores pointer events \(pointer-events: none\)/);

      assert.equal(
        hits.some((i) => /OK/.test(`${i.where ?? ""} ${i.message}`)),
        false,
        `OK is clickable, got ${dump}`,
      );
      assert.equal(
        hits.some((i) => /Child/.test(`${i.where ?? ""} ${i.message}`)),
        false,
        `child with pointer-events auto under a none parent must not flag, got ${dump}`,
      );
      assert.equal(
        hits.some((i) =>
          /Off|AriaOff|AriaHid|Ghost|Inert|Skip|aria-off|aria-hid|inert-btn|ghost/.test(
            `${i.where ?? ""} ${i.message}`,
          ),
        ),
        false,
        `disabled, aria-hidden, inert, hidden, and off-canvas must be skipped, got ${dump}`,
      );
      assert.ok(
        hits.some((i) => /below/.test(i.where ?? "")),
        `below-the-fold pointer-events:none must still flag, got ${dump}`,
      );
      assert.ok(hits.length <= 8);
    });
  });
});
