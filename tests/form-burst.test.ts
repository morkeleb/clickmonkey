import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { skipInspectForBurstLine } from "../src/brains/types.js";
import { bootRun } from "../src/executor/boot.js";
import { createExecutor } from "../src/executor/run.js";
import { withRun } from "../src/executor/session.js";
import { saveConfig } from "../src/persist/config.js";
import { Config } from "../src/schema/index.js";
import { serveSite } from "./helpers/fixture-server.js";

function dialogFormConfig(url: string): Config {
  return Config.parse({
    url,
    writePolicy: "allow",
    screenshots: false,
    map: {
      schemaVersion: 1,
      app: "dialog-form",
      pages: [
        {
          id: "customers",
          path: "/",
          ready: { by: "testId", value: "customers" },
          surfaces: [
            {
              id: "page",
              kind: "page",
              fields: [],
              actions: [
                {
                  id: "list_action_create",
                  by: "testId",
                  value: "list-action-create",
                  status: "ok",
                },
                {
                  id: "customers_action_customer_create",
                  by: "testId",
                  value: "customers-action-customer-create",
                  opens: "add_customer",
                  status: "ok",
                },
              ],
            },
            {
              id: "add_customer",
              kind: "dialog",
              locator: { by: "role", value: "dialog", name: "Add customer" },
              fields: [
                {
                  id: "name",
                  required: true,
                  type: "text",
                  by: "name",
                  value: "name",
                  status: "ok",
                },
                {
                  id: "notes",
                  required: false,
                  type: "textarea",
                  by: "name",
                  value: "notes",
                  status: "ok",
                },
              ],
              actions: [
                {
                  id: "button_create",
                  by: "testId",
                  value: "button-create",
                  status: "ok",
                },
              ],
            },
          ],
        },
      ],
    },
  });
}

describe("form burst", () => {
  it("fills name + notes + Create as one pass without inspect or Escape between", async () => {
    const { baseUrl, close } = await serveSite("dialog-form");
    const tmp = mkdtempSync(join(tmpdir(), "cm-form-burst-"));
    const configPath = join(tmp, "clickmonkey.json");
    const outDir = join(tmp, "out");
    try {
      const config = dialogFormConfig(baseUrl);
      saveConfig(configPath, config);
      await withRun({ timeout: 20_000 }, async (handle) => {
        const state = await bootRun(handle, config, outDir, { configPath });
        const exec = createExecutor(state);
        const open = await exec.runLine("click page.customers_action_customer_create");
        assert.equal(open.ok, true, open.finding?.message);
        assert.equal(await handle.page.getByTestId("add-customer-dialog").evaluate((el) => (el as HTMLDialogElement).open), true);

        const burst = [
          "fill add_customer.name Ada",
          "fill add_customer.notes Hello",
          "click add_customer.button_create",
        ];
        for (let i = 0; i < burst.length; i++) {
          const result = await exec.runLine(burst[i]!, {
            skipInspect: skipInspectForBurstLine(i, burst.length),
          });
          assert.equal(result.ok, true, result.finding?.message);
          if (i < burst.length - 1) {
            assert.equal(
              await handle.page.getByTestId("add-customer-dialog").evaluate((el) => (el as HTMLDialogElement).open),
              true,
              `dialog closed after ${burst[i]}`,
            );
          }
        }
        assert.equal(await handle.page.evaluate("document.body.dataset.submitted"), "1");
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await close();
    }
  });
});
