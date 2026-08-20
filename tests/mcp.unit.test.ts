import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { writeSessionMd } from "../src/playbooks/explore-session.js";
import { emptyConfig } from "../src/schema/config.js";
import { formatExploreVisit, type ExploreVisit } from "../src/schema/visit.js";
import type { ExploreResult, ExploreStepResult } from "../src/playbooks/explore-session.js";
import {
  createMcpHost,
  handleExploreFinish,
  handleExploreStart,
  handleExploreStep,
  handleNastyList,
  type McpHost,
  type McpSession,
} from "../src/mcp/tools.js";

function visitOf(): ExploreVisit {
  return formatExploreVisit({
    view: {
      page: "home",
      surface: "page",
      stack: ["page"],
      shown: [{ id: "name", value: "", type: "text" }],
      actions: [{ id: "submit" }],
      last: { step: "open home", ok: true },
    },
    legalOpen: ["home"],
    shot: "shots/step-001.png",
  });
}

function emptyResult(sessionPath: string, logPath: string): ExploreResult {
  return {
    ok: true,
    findings: [],
    log: { schemaVersion: 1, comments: [], steps: [], usedLocators: {}, result: "passed" },
    logPath,
    sessionPath,
    stepsUsed: 0,
  };
}

function stubSession(overrides: Partial<McpSession> = {}): McpSession {
  const visit = visitOf();
  return {
    started: true,
    outDir: "/tmp/clickmonkey-mcp-fake",
    pages: [],
    start: async () => visit,
    visit: async () => visit,
    step: async () => ({ ok: true, result: {} as never, visit, newProductFinding: false }),
    setPlan: () => undefined,
    advancePlan: () => undefined,
    addNote: () => undefined,
    addGood: () => undefined,
    finish: async () => emptyResult("", ""),
    ...overrides,
  };
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  const block = result.content.find((c) => c.type === "text");
  assert.ok(block?.text);
  return block.text;
}

describe("mcp tools", () => {
  it("explore_start without config is a tool error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-mcp-noconfig-"));
    try {
      const host = createMcpHost();
      const result = await handleExploreStart(host, { config: join(dir, "clickmonkey.json") });
      assert.equal(result.isError, true);
      assert.match(textOf(result), /explore_init/);
      assert.match(textOf(result), /clickmonkey init/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("step handler surfaces the check error and the same visit", async () => {
    const visit = visitOf();
    const step: McpSession["step"] = async (): Promise<ExploreStepResult> => ({
      ok: false,
      error: "unknown id page.xyz",
      visit,
    });
    const host: McpHost = { session: stubSession({ step }) };
    const result = await handleExploreStep(host, { line: "click page.xyz" });
    assert.equal(result.isError, true);
    const text = textOf(result);
    assert.match(text, /unknown id page\.xyz/);
    assert.ok(text.includes(visit.formatted));
    assert.equal(text.includes("iVBORw0KGgo"), false);
  });

  it("finish calls writeSessionMd", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-mcp-finish-"));
    const sessionPath = join(dir, "session.md");
    const logPath = join(dir, "log.txt");
    let finished = 0;
    try {
      const host: McpHost = {
        session: stubSession({
          outDir: dir,
          configPath: join(dir, "clickmonkey.json"),
          config: emptyConfig("http://127.0.0.1:4173/"),
          finish: async () => {
            finished += 1;
            writeSessionMd({
              path: sessionPath,
              startedAt: Date.parse("2026-01-02T03:04:05.000Z"),
              charter: "walk the form",
              config: emptyConfig("http://127.0.0.1:4173/"),
              findings: [],
              notes: ["Runtime: blank name accepted"],
              goods: [],
            });
            return emptyResult(sessionPath, logPath);
          },
        }),
      };
      const result = await handleExploreFinish(host, { report: false });
      assert.equal(result.isError, undefined);
      assert.equal(finished, 1);
      assert.ok(existsSync(sessionPath));
      assert.match(readFileSync(sessionPath, "utf8"), /walk the form/);
      assert.match(textOf(result), /sessionPath:/);
      assert.match(textOf(result), /logPath:/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("nasty_list has xss", async () => {
    const result = await handleNastyList();
    assert.equal(result.isError, undefined);
    assert.match(textOf(result), /\bxss\b/);
  });

  it("handlers contain no walk logic", () => {
    const dir = fileURLToPath(new URL("../src/mcp/", import.meta.url));
    for (const name of ["tools.ts", "server.ts"]) {
      const src = readFileSync(join(dir, name), "utf8");
      assert.equal(src.includes("checkExploreLine"), false, name);
      assert.equal(src.includes("bootRun"), false, name);
      assert.equal(src.includes("createExecutor"), false, name);
      assert.equal(src.includes("applyExploreStep"), false, name);
      assert.equal(src.includes("loadPayloads"), false, name);
      assert.equal(src.includes("formatView("), false, name);
      assert.equal(src.includes("writeSessionMd"), false, name);
    }
  });
});
