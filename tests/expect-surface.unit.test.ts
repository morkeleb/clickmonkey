import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { locatorForSurface } from "../src/executor/steps.js";
import { PageModel } from "../src/schema/page-model.js";

function modelState() {
  const model = PageModel.parse({
    schemaVersion: 1,
    app: "fixture",
    generation: 0,
    pages: [
      {
        id: "home",
        path: "/",
        params: [],
        ready: { by: "testId", value: "home" },
        surfaces: [
          { id: "page", kind: "page", fields: [], actions: [] },
          {
            id: "add_customer",
            kind: "dialog",
            locator: { by: "testId", value: "add-customer" },
            fields: [],
            actions: [],
          },
        ],
      },
    ],
  });
  return { model, pageId: "home" };
}

describe("locatorForSurface", () => {
  it("uses a dialog locator and the page ready for expect visible/hidden", () => {
    const state = modelState();
    const dialog = locatorForSurface(state, "add_customer");
    assert.equal(dialog.ok, true);
    if (dialog.ok) assert.equal(dialog.loc.value, "add-customer");
    const page = locatorForSurface(state, "page");
    assert.equal(page.ok, true);
    if (page.ok) assert.equal(page.loc.value, "home");
    const named = locatorForSurface(state, "home");
    assert.equal(named.ok, true);
    if (named.ok) assert.equal(named.loc.value, "home");
  });

  it("does not treat a typo as the current page ready", () => {
    const miss = locatorForSurface(modelState(), "typo");
    assert.equal(miss.ok, false);
    if (!miss.ok) {
      assert.equal(miss.failure.kind, "unknownId");
      assert.match(miss.failure.message, /unknown surface typo/);
    }
  });
});
