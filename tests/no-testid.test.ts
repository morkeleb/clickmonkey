import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickActable, toPlaywrightLocator } from "../src/executor/locators.js";
import { withRun } from "../src/executor/session.js";
import { emptyDraft } from "../src/schema/index.js";
import { locatorOf } from "../src/schema/locator.js";
import { inspect } from "../src/surveyor/inspect.js";
import { serveSite } from "./helpers/fixture-server.js";

describe("inspect without testids", () => {
  it("maps Create by role name and clicks it", async () => {
    const { baseUrl, close } = await serveSite("no-testid");
    try {
      await withRun({}, async ({ page }) => {
        await page.goto(`${baseUrl}/`);
        const result = await inspect(page, { model: emptyDraft() });
        const surface = result.model.pages[0]?.surfaces.find((s) => s.kind === "page");
        const create = surface?.actions.find((a) => a.name === "Create" || a.id === "button_create");
        assert.ok(create, `actions: ${surface?.actions.map((a) => a.id).join(", ")}`);
        assert.equal(create.by, "role");
        assert.equal(create.value, "button");
        assert.equal(create.name, "Create");
        assert.notEqual(create.by, "testId");
        const hit = await pickActable(toPlaywrightLocator(page, locatorOf(create)), page);
        assert.ok(hit);
        await hit.click();
        assert.equal(await page.locator("dialog").evaluate((el) => (el as HTMLDialogElement).open), true);
      });
    } finally {
      await close();
    }
  });
});
