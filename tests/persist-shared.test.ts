import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { emptyConfig } from "../src/schema/config.js";
import { loadConfig, persistSharedMap, saveConfig } from "../src/persist/config.js";
import { mapPath } from "../src/persist/workspace.js";
import { PageModel } from "../src/schema/page-model.js";
import { fileURLToPath } from "node:url";

function validHome() {
  const path = fileURLToPath(new URL("../fixtures/models/valid-home.json", import.meta.url));
  return PageModel.parse(JSON.parse(readFileSync(path, "utf8")));
}

describe("persistSharedMap", () => {
  it("unions two parallel writes into one map file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-map-"));
    const path = join(dir, "clickmonkey.json");
    const base = emptyConfig("http://127.0.0.1:4173/", "fixture");
    saveConfig(path, { ...base, map: validHome() });

    const footer = structuredClone(validHome());
    footer.pages[0]!.surfaces[0]!.actions.push({
      id: "site_footer",
      by: "testId",
      value: "site-footer",
      status: "ok",
    });
    const login = structuredClone(validHome());
    login.pages.push({
      id: "login",
      path: "/login",
      params: [],
      ready: { by: "testId", value: "login" },
      surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
    });

    await Promise.all([
      Promise.resolve().then(() => persistSharedMap(path, footer)),
      Promise.resolve().then(() => persistSharedMap(path, login)),
    ]);

    const disk = loadConfig(path);
    assert.ok(disk.map.pages.some((p) => p.id === "login"));
    const home = disk.map.pages.find((p) => p.id === "home");
    assert.ok(home?.surfaces[0]?.actions.some((a) => a.id === "site_footer"));
    assert.ok(home?.surfaces[0]?.actions.some((a) => a.id === "openCreate"));
    assert.ok(existsSync(mapPath(path)));
    const leash = JSON.parse(readFileSync(path, "utf8")) as { map?: unknown };
    assert.equal(leash.map, undefined);
  });
});
