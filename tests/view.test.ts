import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { withRun } from "../src/executor/session.js";
import { buildView, formatView } from "../src/executor/view.js";
import { PageModel } from "../src/schema/index.js";
import { serveSite } from "./helpers/fixture-server.js";

const homeModel = PageModel.parse(
  JSON.parse(
    readFileSync(fileURLToPath(new URL("../fixtures/models/valid-home.json", import.meta.url)), "utf8"),
  ) as unknown,
);

describe("buildView", () => {
  it("shows ok fields on the current surface without HTML", async () => {
    const { baseUrl, close } = await serveSite("validates");
    try {
      await withRun({}, async ({ page }) => {
        await page.goto(baseUrl);
        await page.getByTestId("open-create").click();
        const view = await buildView({
          page,
          pageId: "home",
          surfaceStack: ["page", "createDialog"],
          model: homeModel,
        });
        assert.equal(view.page, "home");
        assert.equal(view.surface, "createDialog");
        assert.deepEqual(view.stack, ["page", "createDialog"]);
        const name = view.shown.find((f) => f.id === "name");
        assert.ok(name);
        assert.equal(name.value, "");
        assert.equal(name.required, true);
        assert.equal(name.type, "text");
        assert.ok(view.actions.some((a) => a.id === "submit"));
        const json = JSON.stringify(view);
        assert.equal(/<\/?[a-z][\s\S]*>/i.test(json), false);
        const text = formatView(view);
        assert.match(text, /surface: createDialog/);
        assert.match(text, /name: ""  \[required, text\]/);
      });
    } finally {
      await close();
    }
  });
});
