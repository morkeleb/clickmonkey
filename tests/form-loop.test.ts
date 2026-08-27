import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { saveConfig } from "../src/persist/config.js";
import { runUnleash } from "../src/playbooks/unleash.js";
import { Config } from "../src/schema/config.js";
import { serveSite } from "./helpers/fixture-server.js";

function typeaheadFormConfig(url: string): Config {
  return Config.parse({
    url,
    writePolicy: "allow",
    map: {
      schemaVersion: 1,
      app: "typeahead-form",
      pages: [
        {
          id: "create_html",
          path: "/create.html",
          ready: { by: "testId", value: "create" },
          surfaces: [
            {
              id: "page",
              kind: "page",
              fields: [
                {
                  id: "country",
                  required: true,
                  type: "combobox",
                  by: "testId",
                  value: "country",
                  status: "ok",
                },
              ],
              actions: [{ id: "submit", by: "testId", value: "submit", status: "ok" }],
            },
          ],
        },
        {
          id: "ok_html",
          path: "/ok.html",
          ready: { by: "testId", value: "ok" },
          surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
        },
      ],
    },
  });
}

describe("unleash --form loop", () => {
  it("fills the locked form and stops after submit leaves the page", async () => {
    const { baseUrl, close } = await serveSite("typeahead-form");
    const tmp = mkdtempSync(join(tmpdir(), "cm-form-loop-"));
    const configPath = join(tmp, "clickmonkey.json");
    const outDir = join(tmp, "out");
    const echo: string[] = [];
    try {
      const config = typeaheadFormConfig(`${baseUrl.replace(/\/$/, "")}/create.html`);
      saveConfig(configPath, config);
      const result = await runUnleash({
        config,
        configPath,
        outDir,
        steps: 20,
        form: "create_html",
        timeout: 20_000,
        echo: { write: (chunk) => echo.push(String(chunk)) },
      });
      assert.equal(result.lockForm, "create_html");
      assert.ok(result.submitted, echo.join(""));
      assert.equal(result.submitted?.from, "create_html");
      assert.notEqual(result.submitted?.to, "create_html");
      assert.match(echo.join(""), /form-loop submitted create_html → /);
      assert.match(echo.join(""), /ok\.html/);
      assert.ok(result.ok);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await close();
    }
  });
});
