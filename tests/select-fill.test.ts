import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { bootRun } from "../src/executor/boot.js";
import { createExecutor } from "../src/executor/run.js";
import { withRun } from "../src/executor/session.js";
import { buildView } from "../src/executor/view.js";
import { Config } from "../src/schema/index.js";
import { serveSite } from "./helpers/fixture-server.js";

function selectFormConfig(url: string): Config {
  return Config.parse({
    url,
    map: {
      schemaVersion: 1,
      app: "select-form",
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
                  id: "addressType",
                  required: false,
                  type: "select",
                  by: "name",
                  value: "addressType",
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

describe("native select fill", () => {
  it("harvests live options and fails fast on a value that is not one of them", async () => {
    const { baseUrl, close } = await serveSite("select-form");
    const outDir = mkdtempSync(join(tmpdir(), "cm-select-"));
    try {
      await withRun({ timeout: 8_000 }, async (handle) => {
        const state = await bootRun(handle, selectFormConfig(baseUrl), outDir);
        const view = await buildView({
          page: handle.page,
          pageId: state.pageId,
          surfaceStack: state.surfaceStack,
          model: state.model,
        });
        const field = view.shown.find((f) => f.id === "addressType");
        assert.ok(field);
        assert.equal(field.type, "select");
        assert.deepEqual(
          field.options?.map((o) => o.label),
          ["Select type", "Mailing", "Remittance", "Physical"],
        );

        const exec = createExecutor(state);
        const started = Date.now();
        const miss = await exec.runLine("fill page.addressType x");
        const elapsed = Date.now() - started;
        assert.equal(miss.ok, false);
        assert.equal(miss.finding?.kind, "expectFailed");
        assert.match(miss.finding?.message ?? "", /no option "x"/);
        assert.match(miss.finding?.message ?? "", /Mailing \/ Remittance \/ Physical/);
        assert.ok(elapsed < 5_000, `selectOption hung ${elapsed}ms`);

        const hit = await exec.runLine("fill page.addressType Mailing");
        assert.equal(hit.ok, true, hit.finding?.message);
        assert.equal(await handle.page.locator('[name="addressType"]').inputValue(), "mailing");
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      await close();
    }
  });
});
