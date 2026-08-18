import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { bootRun } from "../src/executor/boot.js";
import { createExecutor } from "../src/executor/run.js";
import { withRun } from "../src/executor/session.js";
import { Config } from "../src/schema/index.js";
import { serveSite } from "./helpers/fixture-server.js";

describe("surface-scoped click", () => {
  it("clicks the dialog Settings when a page Settings also exists", async () => {
    const { baseUrl, close } = await serveSite("dup-role");
    const outDir = mkdtempSync(join(tmpdir(), "cm-dup-"));
    try {
      await withRun({}, async (handle) => {
        await handle.page.goto(baseUrl);
        const config = Config.parse({
          url: baseUrl,
          map: {
            schemaVersion: 1,
            app: "dup",
            pages: [
              {
                id: "home",
                path: "/",
                ready: { by: "testId", value: "home" },
                surfaces: [
                  {
                    id: "page",
                    kind: "page",
                    fields: [],
                    actions: [
                      { id: "open_tabs", by: "testId", value: "open-tabs", status: "ok" },
                      { id: "button_settings", by: "role", value: "button", name: "Settings", status: "ok" },
                    ],
                  },
                  {
                    id: "tabs",
                    kind: "dialog",
                    locator: { by: "role", value: "dialog", name: "Active tabs: 1" },
                    fields: [],
                    actions: [
                      { id: "button_settings", by: "role", value: "button", name: "Settings", status: "ok" },
                    ],
                  },
                ],
              },
            ],
          },
        });
        const state = await bootRun(handle, config, outDir);
        const exec = createExecutor(state);
        const open = await exec.runLine("click page.open_tabs");
        assert.equal(open.ok, true, open.finding?.message);
        const click = await exec.runLine("click tabs.button_settings");
        assert.equal(click.ok, true, click.finding?.message);
        const picked = await handle.page.getByTestId("tabs-dialog").getAttribute("data-picked");
        assert.equal(picked, "popover");
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      await close();
    }
  });
});
