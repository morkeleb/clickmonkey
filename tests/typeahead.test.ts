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
                {
                  id: "industry",
                  required: false,
                  type: "text",
                  by: "testId",
                  value: "industry",
                  status: "ok",
                },
                {
                  id: "vendor",
                  required: false,
                  type: "text",
                  by: "testId",
                  value: "vendor",
                  status: "ok",
                },
                {
                  id: "matter",
                  required: false,
                  type: "text",
                  by: "testId",
                  value: "matter",
                  status: "ok",
                },
                {
                  id: "emptyVendor",
                  required: false,
                  type: "text",
                  by: "testId",
                  value: "empty-vendor",
                  status: "ok",
                },
                {
                  id: "party",
                  required: true,
                  type: "text",
                  by: "testId",
                  value: "party",
                  status: "ok",
                },
                {
                  id: "ownerid",
                  required: false,
                  type: "text",
                  by: "testId",
                  value: "ownerid",
                  status: "ok",
                },
                {
                  id: "region",
                  required: false,
                  type: "text",
                  by: "testId",
                  value: "region",
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

  it("clicks a listed industry row when the planned fill is faker junk", async () => {
    const { baseUrl, close } = await serveSite("typeahead-form");
    const outDir = mkdtempSync(join(tmpdir(), "cm-typeahead-ind-"));
    try {
      await withRun({ timeout: 20_000 }, async (handle) => {
        const state = await bootRun(handle, typeaheadConfig(baseUrl), outDir);
        const exec = createExecutor(state);
        const miss = await exec.runLine('fill page.industry "beatus bos"');
        assert.equal(miss.ok, true, miss.finding?.message);
        const typed = await handle.page.locator('[data-testid="industry"]').inputValue();
        assert.notEqual(typed, "beatus bos");
        const industry = await handle.page.locator("#industryId").inputValue();
        assert.match(industry, /Soybean Farming|Oilseed|Corn Farming/, industry);
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      await close();
    }
  });

  it("clicks a listed menu button when the popup has no role=option", async () => {
    const { baseUrl, close } = await serveSite("typeahead-form");
    const outDir = mkdtempSync(join(tmpdir(), "cm-typeahead-vendor-"));
    try {
      await withRun({ timeout: 20_000 }, async (handle) => {
        const state = await bootRun(handle, typeaheadConfig(baseUrl), outDir);
        const exec = createExecutor(state);
        const miss = await exec.runLine('fill page.vendor "aequitas vulticulus"');
        assert.equal(miss.ok, true, miss.finding?.message);
        const vendor = await handle.page.locator("#vendorId").inputValue();
        assert.match(vendor, /Acme Supplies|Seed Office|FV Admin/, vendor);
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      await close();
    }
  });

  it("picks a listed row that only has addEventListener('click')", async () => {
    const { baseUrl, close } = await serveSite("typeahead-form");
    const outDir = mkdtempSync(join(tmpdir(), "cm-typeahead-matter-"));
    try {
      await withRun({ timeout: 20_000 }, async (handle) => {
        const state = await bootRun(handle, typeaheadConfig(baseUrl), outDir);
        const exec = createExecutor(state);
        const miss = await exec.runLine('fill page.matter "AAAA"');
        assert.equal(miss.ok, true, miss.finding?.message);
        const matter = await handle.page.locator("#matterId").inputValue();
        assert.match(matter, /Alpha Matter|Beta Matter|Gamma Matter/, matter);
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      await close();
    }
  });

  it("fails when the open list has no clickable rows", async () => {
    const { baseUrl, close } = await serveSite("typeahead-form");
    const outDir = mkdtempSync(join(tmpdir(), "cm-typeahead-empty-"));
    try {
      await withRun({ timeout: 20_000 }, async (handle) => {
        const state = await bootRun(handle, typeaheadConfig(baseUrl), outDir);
        const exec = createExecutor(state);
        const miss = await exec.runLine('fill page.emptyVendor "beatus bos"');
        assert.equal(miss.ok, false);
        assert.match(miss.finding?.message ?? "", /no matching options|could not click a listed option|no options to pick/);
        assert.match(miss.finding?.message ?? "", /Empty vendor|emptyVendor/);
        assert.equal(await handle.page.locator('[data-testid="empty-vendor"]').inputValue(), "");
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      await close();
    }
  });

  it("misses a required Select-prompt chip that never commits a row", async () => {
    const { baseUrl, close } = await serveSite("typeahead-form");
    const outDir = mkdtempSync(join(tmpdir(), "cm-typeahead-party-"));
    try {
      await withRun({ timeout: 20_000 }, async (handle) => {
        const state = await bootRun(handle, typeaheadConfig(baseUrl), outDir);
        const exec = createExecutor(state);
        const miss = await exec.runLine('fill page.party "beatus bos"');
        assert.equal(miss.ok, false, miss.finding?.message ?? "expected a required listed miss");
        assert.match(miss.finding?.message ?? "", /no matching options|no options to pick|could not click a listed option/);
        assert.equal(await handle.page.locator('[data-testid="party"]').inputValue(), "");
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      await close();
    }
  });

  it("skips an optional empty listed *id picker", async () => {
    const { baseUrl, close } = await serveSite("typeahead-form");
    const outDir = mkdtempSync(join(tmpdir(), "cm-typeahead-owner-"));
    try {
      await withRun({ timeout: 20_000 }, async (handle) => {
        const state = await bootRun(handle, typeaheadConfig(baseUrl), outDir);
        const exec = createExecutor(state);
        const skip = await exec.runLine('fill page.ownerid "beatus bos"');
        assert.equal(skip.ok, true, skip.finding?.message);
        assert.equal(await handle.page.locator('[data-testid="ownerid"]').inputValue(), "");
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      await close();
    }
  });

  it("clicks a role=option row even when the option has pointer-events none", async () => {
    const { baseUrl, close } = await serveSite("typeahead-form");
    const outDir = mkdtempSync(join(tmpdir(), "cm-typeahead-region-"));
    try {
      await withRun({ timeout: 20_000 }, async (handle) => {
        const state = await bootRun(handle, typeaheadConfig(baseUrl), outDir);
        const exec = createExecutor(state);
        const hit = await exec.runLine('fill page.region "beatus bos"');
        assert.equal(hit.ok, true, hit.finding?.message);
        const region = await handle.page.locator("#regionId").inputValue();
        assert.match(region, /North|South/, region);
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      await close();
    }
  });
});
