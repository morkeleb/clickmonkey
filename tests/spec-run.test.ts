import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { saveConfig } from "../src/persist/config.js";
import { runSpecs } from "../src/playbooks/spec.js";
import { Config } from "../src/schema/config.js";
import { serveSite } from "./helpers/fixture-server.js";

const specFile = fileURLToPath(
  new URL("../fixtures/sites/typeahead-form/specs/create-with-listed-country.md", import.meta.url),
);

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

describe("spec_run typeahead-form", () => {
  it("replays create-with-listed-country and lands on /ok.html", async () => {
    const { baseUrl, close } = await serveSite("typeahead-form");
    const tmp = mkdtempSync(join(tmpdir(), "cm-spec-run-"));
    const configPath = join(tmp, "clickmonkey.json");
    const outDir = join(tmp, "out");
    try {
      const config = typeaheadFormConfig(baseUrl);
      saveConfig(configPath, config);
      const result = await runSpecs({
        config,
        configPath,
        outDir,
        files: [specFile],
        timeout: 20_000,
      });
      assert.equal(result.ok, true, result.cases.map((c) => `${c.title}: ${c.error ?? "ok"}`).join("\n"));
      assert.equal(result.cases.length, 1);
      assert.equal(result.cases[0]?.ok, true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await close();
    }
  });
});
