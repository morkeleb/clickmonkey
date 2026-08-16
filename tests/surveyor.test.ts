import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { withRun } from "../src/executor/session.js";
import { emptyDraft, PageModel } from "../src/schema/index.js";
import type { PageModel as PageModelType } from "../src/schema/page-model.js";
import { inspect } from "../src/surveyor/inspect.js";
import { determineReady } from "../src/surveyor/ready.js";
import { serveSite } from "./helpers/fixture-server.js";

function loadHome(): PageModelType {
  const path = fileURLToPath(new URL("../fixtures/models/valid-home.json", import.meta.url));
  return PageModel.parse(JSON.parse(readFileSync(path, "utf8")));
}

describe("inspect", () => {
  it("surveys dialog-open from an empty draft", async () => {
    const { baseUrl, close } = await serveSite("dialog-open");
    try {
      await withRun({}, async ({ page }) => {
        await page.goto(`${baseUrl}/`);
        const result = await inspect(page, { model: emptyDraft() });

        assert.equal("snapshot" in result, false);
        assert.doesNotMatch(JSON.stringify(result), /"<main/);
        assert.doesNotMatch(JSON.stringify(result), /"role":\s*"WebArea"/);
        assert.ok(result.candidatesFound >= 3);
        assert.equal(result.pageId, "home");

        const home = result.model.pages[0];
        assert.ok(home);
        const kinds = home.surfaces.map((s) => s.kind).sort();
        assert.deepEqual(kinds, ["dialog", "page"]);

        const pageSurf = home.surfaces.find((s) => s.kind === "page");
        const dialogSurf = home.surfaces.find((s) => s.kind === "dialog");
        assert.ok(pageSurf);
        assert.ok(dialogSurf);

        assert.ok(!pageSurf.fields.some((f) => f.id === "name" || f.value === "name"));
        assert.ok(!pageSurf.actions.some((a) => a.id === "submit" || a.value === "submit"));
        assert.ok(dialogSurf.fields.some((f) => f.value === "name"));
        assert.ok(dialogSurf.actions.some((a) => a.value === "submit"));
      });
    } finally {
      await close();
    }
  });

  it("appends footer onto valid-home and increments generation", async () => {
    const { baseUrl, close } = await serveSite("with-footer");
    try {
      await withRun({}, async ({ page }) => {
        await page.goto(`${baseUrl}/`);
        const before = loadHome();
        assert.equal(before.generation, 0);
        const result = await inspect(page, { model: before });

        assert.equal(result.pageId, "home");
        assert.equal(result.model.generation, 1);
        assert.equal(result.merged, true);

        const home = result.model.pages[0];
        assert.ok(home);
        const pageSurf = home.surfaces.find((s) => s.kind === "page");
        assert.ok(pageSurf);
        assert.ok(pageSurf.actions.some((a) => a.value === "open-create"));
        const footer = pageSurf.actions.find((a) => a.value === "site-footer");
        assert.ok(footer);
        assert.equal(footer.by, "testId");
        assert.equal(footer.status, "ok");

        const dialog = home.surfaces.find((s) => s.id === "createDialog");
        assert.ok(dialog);
        assert.equal(dialog.fields[0]?.id, "name");
        assert.equal(dialog.fields[0]?.status, "ok");
      });
    } finally {
      await close();
    }
  });

  it("starts a map on a page with only an h1 (no testid or main)", async () => {
    const { baseUrl, close } = await serveSite("plain");
    try {
      await withRun({}, async ({ page }) => {
        await page.goto(`${baseUrl}/`);
        const ready = await determineReady(page);
        assert.equal(ready.by, "role");
        assert.equal(ready.value, "heading");
        assert.equal(ready.name, "Example Domain");

        const result = await inspect(page, { model: emptyDraft("plain") });
        assert.equal(result.pageId, "home");
        assert.equal(result.model.pages[0]?.ready.by, "role");
        assert.equal(result.model.pages[0]?.ready.value, "heading");
        assert.ok(result.model.pages[0]?.surfaces.some((s) => s.kind === "page"));
      });
    } finally {
      await close();
    }
  });
});
