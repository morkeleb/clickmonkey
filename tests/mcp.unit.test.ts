import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { SAMPLE_MAX_CHARS } from "../src/brains/nasty.js";
import { saveConfig } from "../src/persist/config.js";
import { writeSessionMd } from "../src/playbooks/explore-session.js";
import { emptyConfig } from "../src/schema/config.js";
import { formatExploreVisit, type ExploreVisit } from "../src/schema/visit.js";
import type { ExploreResult, ExploreStepResult } from "../src/playbooks/explore-session.js";
import {
  createMcpHost,
  handleExploreFinish,
  handleExploreShot,
  handleExploreStart,
  handleExploreStep,
  handleNastyList,
  handleNastySamples,
  sessionResourceText,
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
    abort: async () => undefined,
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

  it("explore_step screenshot line is text-only", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-mcp-shot-"));
    const png = join(dir, "step.png");
    writeFileSync(
      png,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    try {
      const visit = visitOf();
      const host: McpHost = {
        session: stubSession({
          lastScreenshotPath: png,
          step: async () => ({ ok: true, result: {} as never, visit, newProductFinding: false }),
        }),
      };
      const result = await handleExploreStep(host, { line: "screenshot" });
      assert.equal(result.isError, undefined);
      assert.equal(result.content.length, 1);
      assert.equal(result.content[0]?.type, "text");
      assert.match(textOf(result), /^shot: /m);
      assert.equal(
        result.content.some((c) => c.type === "image"),
        false,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("visit text includes clipped sight and omits mode/last already in formatView", async () => {
    const visit = formatExploreVisit({
      view: {
        page: "home",
        surface: "page",
        stack: ["page"],
        shown: [],
        actions: [{ id: "submit" }],
        mode: "form",
        last: { step: "open home", ok: true },
      },
      legalOpen: ["home"],
      shot: "shots/step-001.png",
      sight: `${"overlap ".repeat(40)}end`,
    });
    const host: McpHost = {
      session: stubSession({
        step: async () => ({ ok: true, result: {} as never, visit, newProductFinding: false }),
      }),
    };
    const text = textOf(await handleExploreStep(host, { line: "click page.submit" }));
    const header = text.split("\n\n")[0] ?? "";
    assert.match(header, /^sight: /m);
    assert.match(header, /…$/m);
    assert.doesNotMatch(header, /^mode:/m);
    assert.doesNotMatch(header, /^last:/m);
    assert.match(visit.formatted, /^mode: form$/m);
    assert.match(visit.formatted, /^last: /m);
  });

  it("explore_start forwards skills to the session", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-mcp-skills-"));
    const configPath = join(dir, "clickmonkey.json");
    let seen: string | undefined;
    try {
      saveConfig(configPath, emptyConfig("http://127.0.0.1:4173/"));
      const host: McpHost = {
        createSession: () =>
          stubSession({
            start: async (opts) => {
              seen = opts.skills;
              return visitOf();
            },
          }),
      };
      const result = await handleExploreStart(host, {
        config: configPath,
        skills: "billing lives under settings",
      });
      assert.equal(result.isError, undefined);
      assert.equal(seen, "billing lives under settings");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("explore_start extras point at the map resource instead of dumping the DAG", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-mcp-start-"));
    const configPath = join(dir, "clickmonkey.json");
    try {
      saveConfig(configPath, emptyConfig("http://127.0.0.1:4173/"));
      const host: McpHost = {
        createSession: () => stubSession({ start: async () => visitOf() }),
      };
      const result = await handleExploreStart(host, { config: configPath });
      assert.equal(result.isError, undefined);
      const text = textOf(result);
      assert.match(text, /Legal open ids: home/);
      assert.match(text, /sitemap: clickmonkey:\/\/map/);
      assert.match(text, /explore_tester/);
      assert.doesNotMatch(text, /^reach:/m);
      assert.doesNotMatch(text, /sitemap \(open only where via says open\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("explore_start finish on start failure when still started", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-mcp-startfail-"));
    const configPath = join(dir, "clickmonkey.json");
    let finished = 0;
    try {
      saveConfig(configPath, emptyConfig("http://127.0.0.1:4173/"));
      const host: McpHost = {
        session: stubSession({
          started: true,
          start: async () => {
            throw new Error("boot failed");
          },
          finish: async () => {
            finished += 1;
            return emptyResult("", "");
          },
        }),
      };
      const result = await handleExploreStart(host, { config: configPath });
      assert.equal(result.isError, true);
      assert.match(textOf(result), /boot failed/);
      assert.equal(finished, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("session resource while live without session.md returns a summary", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-mcp-session-"));
    try {
      const host: McpHost = {
        session: stubSession({
          started: true,
          outDir: dir,
          charter: "walk the form",
          notes: ["Runtime: blank name accepted"],
          goods: ["required name blocks submit"],
          skills: "billing lives under settings",
          findings: [{ id: "F1", message: "blank name saved", kind: "expectFailed", schemaVersion: 1, tapePath: "t", stepIndex: 0 }],
          plan: {
            goal: "Walk home",
            items: [{ id: "1", title: "Empty name", status: "now", stepCount: 0, findingIds: [] }],
          },
        }),
      };
      const text = sessionResourceText(host);
      assert.match(text, /walk the form/);
      assert.match(text, /Walk home/);
      assert.match(text, /Empty name/);
      assert.match(text, /blank name accepted/);
      assert.match(text, /required name blocks submit/);
      assert.match(text, /billing lives under settings/);
      assert.match(text, /F1: blank name saved/);
      assert.match(text, /session.md is written on explore_finish/);
      assert.doesNotMatch(text, /no live session/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("explore_shot rejects paths outside the run directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-mcp-shotjail-"));
    const png = join(dir, "ok.png");
    writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
    try {
      const host: McpHost = { session: stubSession({ outDir: dir, lastScreenshotPath: png }) };
      const escape = await handleExploreShot(host, { path: "../secret.png" });
      assert.equal(escape.isError, true);
      assert.match(textOf(escape), /outside the run directory/);
      const abs = await handleExploreShot(host, { path: "/etc/passwd" });
      assert.equal(abs.isError, true);
      assert.match(textOf(abs), /outside the run directory/);
      const ok = await handleExploreShot(host, { path: "ok.png" });
      assert.equal(ok.isError, undefined);
      assert.equal(ok.content.some((c) => c.type === "image"), true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("session resource is no live session when not started", () => {
    assert.equal(sessionResourceText(createMcpHost()), "no live session\n");
  });

  it("nasty_samples distinguishes unknown catalog from overlong-only", async () => {
    const unknown = await handleNastySamples({ id: "nope" });
    assert.equal(unknown.isError, true);
    assert.match(textOf(unknown), /unknown catalog: nope/);

    const dir = mkdtempSync(join(tmpdir(), "cm-mcp-nasty-"));
    try {
      writeFileSync(join(dir, "overlong.txt"), `${"A".repeat(SAMPLE_MAX_CHARS + 1)}\n`);
      const overlong = await handleNastySamples({ id: "overlong", dir });
      assert.equal(overlong.isError, true);
      assert.match(textOf(overlong), /no samples under/);
      assert.doesNotMatch(textOf(overlong), /unknown catalog/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
