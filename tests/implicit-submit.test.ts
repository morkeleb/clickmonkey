import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { scanImplicitSubmit } from "../src/surveyor/implicit-submit.js";
import { withPage } from "./helpers/with-page.js";

const html = fileURLToPath(new URL("../fixtures/sites/implicit-submit/index.html", import.meta.url));

function blob(issues: Array<{ where?: string; message: string }>): string {
  return JSON.stringify(issues);
}

describe("scanImplicitSubmit", () => {
  it("flags a typeless form button, not explicit submit, type=button, or outside a form", async () => {
    await withPage(html, async (page) => {
      const issues = await scanImplicitSubmit(page);
      const hits = issues.filter((i) => i.rule === "implicitSubmit");
      const dump = blob(hits);

      const cancel = hits.find((i) => /cancel/.test(i.where ?? ""));
      assert.ok(cancel, `expected typeless Cancel, got ${dump}`);
      assert.equal(cancel.source, "visual");
      assert.equal(cancel.severity, "warning");
      assert.equal(cancel.confidence, "high");
      assert.equal(cancel.count, 1);
      assert.equal(cancel.via, undefined);
      assert.equal(cancel.message, "Button Cancel has no type and will submit the form");
      assert.match(cancel.where ?? "", /data-testid="cancel"/);

      const garbage = hits.find((i) => /garbage-type/.test(i.where ?? ""));
      assert.ok(garbage, `invalid type=btn still submits, got ${dump}`);

      const wipe = hits.find((i) => /empty-type/.test(i.where ?? ""));
      assert.ok(wipe, `expected empty type Wipe, got ${dump}`);

      const clear = hits.find((i) => /clear-edit/.test(i.where ?? ""));
      assert.ok(clear, `expected form= associated Clear, got ${dump}`);

      assert.equal(
        hits.some((i) =>
          /save|outside|ok|explicit|reset|hidden-cancel|aria-hidden-cancel|disabled-cancel|aria-disabled-cancel|input-button|tool-bold|tool-save|save-edit|dangling|naics-soy|naics-corn/.test(
            i.where ?? "",
          ),
        ),
        false,
        `explicit types, outside, disabled, hidden, toolbar, input, dangling form=, and open list rows must be skipped, got ${dump}`,
      );
      const add = hits.find((i) => /add-attorney/.test(i.where ?? ""));
      assert.ok(add, `Add Attorney in the form is still implicit submit, got ${dump}`);
      assert.ok(hits.length <= 8);
    });
  });
});
