import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { liveValidate } from "../src/executor/live-validate.js";
import { PageModel } from "../src/schema/index.js";
import { withPage } from "./helpers/with-page.js";

function fixtureModel(name: string) {
  const path = fileURLToPath(new URL(`../fixtures/models/${name}`, import.meta.url));
  return PageModel.parse(JSON.parse(readFileSync(path, "utf8")) as unknown);
}

const html = fileURLToPath(
  new URL("../fixtures/sites/validates/index.html", import.meta.url),
);

describe("liveValidate", () => {
  it("fails when the ready locator is missing", async () => {
    await withPage(html, async (page) => {
      const model = fixtureModel("valid-home.json");
      const home = model.pages[0];
      assert.ok(home);
      home.ready.value = "does-not-exist";
      const result = await liveValidate(page, model);
      assert.equal(result.ok, false);
      assert.equal(result.failures[0]?.widgetRef, "page:home.ready");
    });
  });

  it("passes when ready and page-surface widgets resolve", async () => {
    await withPage(html, async (page) => {
      const model = fixtureModel("valid-home.json");
      const result = await liveValidate(page, model);
      assert.equal(result.ok, true);
      assert.deepEqual(result.failures, []);
    });
  });
});
