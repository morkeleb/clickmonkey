import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { inspect } from "../src/surveyor/inspect.js";
import { withRun } from "../src/executor/session.js";
import { loadConfig, saveConfig } from "../src/persist/config.js";
import { writeLog } from "../src/persist/log.js";
import { runEmptyRequired } from "../src/playbooks/empty-required.js";
import { replayLog } from "../src/playbooks/replay.js";
import { emptyConfig } from "../src/schema/config.js";
import { PageModel } from "../src/schema/index.js";
import { serveSite } from "./helpers/fixture-server.js";

function loadModel(name: string) {
  const path = fileURLToPath(new URL(`../fixtures/models/${name}`, import.meta.url));
  return PageModel.parse(JSON.parse(readFileSync(path, "utf8")) as unknown);
}

describe("replayLog", () => {
  it("replays accepts-empty replay.log as expectFailed", async () => {
    const { baseUrl, close } = await serveSite("accepts-empty");
    const tmp = mkdtempSync(join(tmpdir(), "cm-rp-empty-"));
    const configPath = join(tmp, "clickmonkey.json");
    const playOut = join(tmp, "play");
    const replayOut = join(tmp, "replay");
    try {
      const config = emptyConfig(baseUrl);
      saveConfig(configPath, config);
      const produced = await runEmptyRequired({ config, configPath, outDir: playOut });
      assert.equal(produced.ok, false);
      const replayed = await replayLog({
        config: loadConfig(configPath),
        configPath,
        logPath: produced.logPath,
        outDir: replayOut,
      });
      assert.equal(replayed.ok, false);
      assert.ok(replayed.findings.some((f) => f.kind === "expectFailed"));
      assert.equal(replayed.reproduced?.kind, "expectFailed");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await close();
    }
  });

  it("replays a passing validates log as ok", async () => {
    const { baseUrl, close } = await serveSite("validates");
    const tmp = mkdtempSync(join(tmpdir(), "cm-rp-ok-"));
    const configPath = join(tmp, "clickmonkey.json");
    const playOut = join(tmp, "play");
    const replayOut = join(tmp, "replay");
    try {
      const config = emptyConfig(baseUrl);
      saveConfig(configPath, config);
      const produced = await runEmptyRequired({ config, configPath, outDir: playOut });
      assert.equal(produced.ok, true);
      const replayed = await replayLog({
        config: loadConfig(configPath),
        configPath,
        logPath: produced.logPath,
        outDir: replayOut,
      });
      assert.equal(replayed.ok, true);
      assert.equal(replayed.findings.length, 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await close();
    }
  });

  it("still passes when the map has an extra footer widget", async () => {
    const { baseUrl, close } = await serveSite("with-footer");
    const tmp = mkdtempSync(join(tmpdir(), "cm-rp-footer-"));
    const configPath = join(tmp, "clickmonkey.json");
    const logPath = join(tmp, "validates.log");
    const outDir = join(tmp, "out");
    try {
      let map = loadModel("valid-home.json");
      await withRun({}, async ({ page }) => {
        await page.goto(baseUrl);
        map = (await inspect(page, { model: map })).model;
      });
      const config = { ...emptyConfig(baseUrl), map };
      saveConfig(configPath, config);
      writeLog(logPath, {
        schemaVersion: 1,
        comments: [],
        steps: [
          { kind: "open", page: "home" },
          { kind: "click", surface: "page", id: "openCreate" },
          { kind: "fill", surface: "createDialog", id: "name", value: "" },
          { kind: "click", surface: "createDialog", id: "submit" },
          { kind: "expectInvalid", surface: "createDialog", id: "name" },
        ],
        usedLocators: {},
        result: "passed",
      });
      const replayed = await replayLog({ config, configPath, logPath, outDir });
      assert.equal(replayed.ok, true);
      assert.equal(replayed.findings.length, 0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await close();
    }
  });

  it("fails unknownId when createDialog.name is missing", async () => {
    const { baseUrl, close } = await serveSite("missing-name");
    const tmp = mkdtempSync(join(tmpdir(), "cm-rp-missing-"));
    const configPath = join(tmp, "clickmonkey.json");
    const logPath = join(tmp, "name.log");
    const outDir = join(tmp, "out");
    try {
      const config = { ...emptyConfig(baseUrl), map: loadModel("missing-name.json") };
      saveConfig(configPath, config);
      writeLog(logPath, {
        schemaVersion: 1,
        comments: [],
        steps: [
          { kind: "open", page: "home" },
          { kind: "click", surface: "page", id: "openCreate" },
          { kind: "fill", surface: "createDialog", id: "name", value: "" },
          { kind: "click", surface: "createDialog", id: "submit" },
          { kind: "expectInvalid", surface: "createDialog", id: "name" },
        ],
        usedLocators: {},
      });
      const replayed = await replayLog({ config, configPath, logPath, outDir });
      assert.equal(replayed.ok, false);
      const kind = replayed.findings[0]?.kind;
      assert.ok(kind === "unknownId" || kind === "unresolvedId", `got ${kind}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await close();
    }
  });
});
