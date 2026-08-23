import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { bootRun } from "../src/executor/boot.js";
import { createExecutor } from "../src/executor/run.js";
import { withRun } from "../src/executor/session.js";
import { buildView } from "../src/executor/view.js";
import { plausibleFill } from "../src/brains/unleash.js";
import { Config } from "../src/schema/index.js";
import { serveSite } from "./helpers/fixture-server.js";

function typeaheadConfig(url: string): Config {
  return Config.parse({
    url,
    writePolicy: "allow",
    map: {
      schemaVersion: 1,
      app: "typeahead-form",
      pages: [
        {
          id: "home",
          path: "/",
          ready: { by: "testId", value: "home" },
          surfaces: [
            {
              id: "page",
              kind: "page",
              fields: [
                {
                  id: "country",
                  required: true,
                  type: "text",
                  by: "testId",
                  value: "country",
                  status: "ok",
                },
                {
                  id: "people",
                  required: false,
                  type: "text",
                  by: "testId",
                  value: "people",
                  status: "ok",
                },
                {
                  id: "city",
                  required: false,
                  type: "text",
                  by: "testId",
                  value: "city",
                  status: "ok",
                },
              ],
              actions: [{ id: "submit", by: "testId", value: "submit", status: "ok" }],
            },
          ],
        },
      ],
    },
  });
}

describe("typeahead fill", () => {
  it("harvests combobox options, clicks one, and can submit", async () => {
    const { baseUrl, close } = await serveSite("typeahead-form");
    const outDir = mkdtempSync(join(tmpdir(), "cm-typeahead-"));
    try {
      await withRun({ timeout: 30_000 }, async (handle) => {
        const state = await bootRun(handle, typeaheadConfig(baseUrl), outDir);
        const view = await buildView({
          page: handle.page,
          pageId: state.pageId,
          surfaceStack: state.surfaceStack,
          model: state.model,
        });
        const country = view.shown.find((f) => f.id === "country");
        const people = view.shown.find((f) => f.id === "people");
        const city = view.shown.find((f) => f.id === "city");
        assert.ok(country);
        assert.ok(country.options?.some((o) => o.label === "Norway"), String(country.options?.map((o) => o.label)));
        assert.ok(people?.options?.some((o) => o.label === "Alice"), String(people?.options?.map((o) => o.label)));
        assert.deepEqual(
          city?.options?.map((o) => o.value),
          ["Oslo", "Bergen", "Tromsø"],
        );

        const exec = createExecutor(state);
        const miss = await exec.runLine("fill page.country x");
        assert.equal(miss.ok, true, miss.finding?.message);
        const coerced = await handle.page.locator("#countryId").inputValue();
        assert.ok(["Norway", "Sweden", "Denmark"].includes(coerced), coerced);

        const picked = plausibleFill(country, () => 0, false);
        assert.equal(picked, "Norway");
        const hit = await exec.runLine(`fill page.country ${picked}`);
        assert.equal(hit.ok, true, hit.finding?.message);
        assert.equal(await handle.page.locator("#countryId").inputValue(), "Norway");

        const person = plausibleFill(people!, () => 0, false);
        assert.equal(person, "Alice");
        const personHit = await exec.runLine(`fill page.people ${person}`);
        assert.equal(personHit.ok, true, personHit.finding?.message);
        assert.equal(await handle.page.locator("#peopleId").inputValue(), "Alice");

        const cityHit = await exec.runLine("fill page.city Oslo");
        assert.equal(cityHit.ok, true, cityHit.finding?.message);
        assert.equal(await handle.page.locator('[data-testid="city"]').inputValue(), "Oslo");

        const send = await exec.runLine("click page.submit");
        assert.equal(send.ok, true, send.finding?.message);
        assert.match(handle.page.url(), /ok\.html/);
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      await close();
    }
  });
});
