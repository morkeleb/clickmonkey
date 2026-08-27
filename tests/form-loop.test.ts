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
              ],
              actions: [{ id: "submit", by: "testId", value: "submit", status: "ok" }],
            },
          ],
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
      const config = typeaheadFormConfig(baseUrl);
      saveConfig(configPath, config);
      const result = await runUnleash({
        config,
        configPath,
        outDir,
        steps: 20,
        form: "home",
        timeout: 20_000,
        echo: { write: (chunk) => echo.push(String(chunk)) },
      });
      assert.equal(result.lockForm, "home");
      assert.ok(result.submitted, echo.join(""));
      assert.equal(result.submitted?.from, "home");
      assert.match(echo.join(""), /form-loop submitted/);
      assert.ok(result.ok);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await close();
    }
  });
});
