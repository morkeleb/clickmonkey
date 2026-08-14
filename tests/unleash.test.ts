import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { decideUnleash } from "../src/brains/unleash.js";
import { parseLine } from "../src/schema/dsl.js";
import type { View } from "../src/schema/view.js";
import { serveSite } from "./helpers/fixture-server.js";

const cli = fileURLToPath(new URL("../src/cli/index.ts", import.meta.url));

function run(args: string[]): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", cli, ...args], {
      timeout: 180_000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function viewOf(partial: Partial<View>): View {
  return {
    page: "home",
    surface: "page",
    stack: ["page"],
    shown: [],
    actions: [],
    ...partial,
  };
}

describe("unleash brain", () => {
  it("emits only click/fill ids from the view", () => {
    const view = viewOf({
      shown: [
        { id: "name", value: "", type: "text" },
        { id: "qty", value: "", type: "number" },
        { id: "email", value: "", type: "email" },
      ],
      actions: [{ id: "submit" }, { id: "open_create" }],
    });
    const legal = new Set(["name", "qty", "email", "submit", "open_create"]);
    const fills = new Set(["", "x", "1", "user@example.com"]);
    for (let i = 0; i < 80; i++) {
      const decision = decideUnleash({ view, stepsUsed: i });
      const parsed = parseLine(decision.line);
      assert.ok(parsed && !("comment" in parsed), decision.line);
      if (parsed.kind === "click") {
        assert.equal(parsed.surface, "page");
        assert.ok(legal.has(parsed.id), parsed.id);
      } else if (parsed.kind === "fill") {
        assert.equal(parsed.surface, "page");
        assert.ok(legal.has(parsed.id), parsed.id);
        assert.ok(fills.has(parsed.value), parsed.value);
      } else {
        assert.fail(`unexpected step ${decision.line}`);
      }
    }
  });

  it("clicks when the view only has actions", () => {
    const view = viewOf({ actions: [{ id: "open_create" }] });
    for (let i = 0; i < 20; i++) {
      const decision = decideUnleash({ view, stepsUsed: i });
      assert.match(decision.line, /^click page\.open_create$/);
    }
  });
});

describe("clickmonkey unleash", () => {
  it("walks validates for 8 steps and writes log.txt", async () => {
    const { baseUrl, close } = await serveSite("validates");
    const tmp = mkdtempSync(join(tmpdir(), "cm-unleash-"));
    const cfg = join(tmp, "clickmonkey.json");
    try {
      const init = await run(["init", "--url", baseUrl, "--config", cfg]);
      assert.equal(init.status, 0, init.stderr);
      const out = join(tmp, "out");
      const result = await run(["unleash", "--steps", "8", "--config", cfg, "--out", out]);
      assert.ok(
        result.status === 0 || result.status === 1,
        `unleash exited ${result.status}\n${result.stdout}\n${result.stderr}`,
      );
      const logPath = join(out, "log.txt");
      assert.ok(existsSync(logPath), "log.txt");
      const log = readFileSync(logPath, "utf8");
      assert.match(log, /^(click|fill) /m);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await close();
    }
  });
});
