import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withRun } from "../src/executor/session.js";
import { emptyDraft } from "../src/schema/index.js";
import { inspect } from "../src/surveyor/inspect.js";
import { serveSite } from "./helpers/fixture-server.js";

describe("inspect dialog-open", () => {
  it("yields a page surface and a dialog surface", async () => {
    const { baseUrl, close } = await serveSite("dialog-open");
    try {
      await withRun({}, async ({ page }) => {
        await page.goto(`${baseUrl}/`);
        const result = await inspect(page, { model: emptyDraft() });

        assert.equal(result.surfaceStack.length, 2);
        assert.equal(result.model.pages[0]?.surfaces.length, 2);
        assert.equal(result.currentSurface, result.surfaceStack[1]);
        assert.equal(result.surfaceStack[0], "page");

        const kinds = result.model.pages[0]?.surfaces.map((s) => s.kind).sort();
        assert.deepEqual(kinds, ["dialog", "page"]);
      });
    } finally {
      await close();
    }
  });
});
