import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { SAMPLE_MAX_CHARS } from "../src/brains/nasty.js";
import { saveConfig } from "../src/persist/config.js";
import { specsDir } from "../src/persist/workspace.js";
import { writeSessionMd } from "../src/playbooks/explore-session.js";
import { emptyConfig } from "../src/schema/config.js";
import { PageModel } from "../src/schema/page-model.js";
import { formatExploreVisit, type ExploreVisit } from "../src/schema/visit.js";
import type { ExploreResult, ExploreStepResult } from "../src/playbooks/explore-session.js";
import {
  CLICKMONKEY_GUIDE,
  createMcpHost,
  finishExplore,
  handleExploreFinding,
  handleExploreFindings,
  handleExploreFinish,
  handleExploreShot,
  handleExploreStart,
  handleExploreVisit,
  handleExploreStep,
  handleNastyList,
  handleNastySamples,
  handleSpecCheck,
  handleSpecList,
  handleSpecRun,
  handleSpecSave,
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
    pageState: async () => "page: home\nsurface: page\nfields:\n  name: \"\"\nactions:\n  submit  [enabled]",
    step: async () => ({ ok: true, result: {} as never, visit, newProductFinding: false }),
    setPlan: () => undefined,
    advancePlan: () => undefined,
    addNote: () => undefined,
    addGood: () => undefined,
    finish: async () => emptyResult("", ""),
    abort: async () => undefined,
    tape: () => ({ log: emptyResult("", "").log, logPath: "" }),
    ...overrides,
  };
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  const block = result.content.find((c) => c.type === "text");
  assert.ok(block?.text);
  return block.text;
}

describe("mcp tools", () => {
  it("explore_visit default is compact; full dumps mapped widgets", async () => {
    const visit = visitOf();
    const host: McpHost = {
      session: stubSession({
        livePageUrl: "https://app/home",
        pageState: async () => 'page: home\nactions:\n  button_save  [disabled, aria-disabled]',
      }),
    };
    const compact = await handleExploreVisit(host);
    assert.equal(compact.isError, undefined);
    assert.ok(textOf(compact).includes(visit.formatted));
    assert.doesNotMatch(textOf(compact), /aria-disabled/);
    const full = await handleExploreVisit(host, { full: true });
    assert.match(textOf(full), /detail: full/);
    assert.match(textOf(full), /button_save/);
    assert.match(textOf(full), /disabled/);
  });

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
      assert.equal(host.lastWalk?.logPath, logPath);
      assert.equal(host.lastWalk?.configPath, join(dir, "clickmonkey.json"));
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

  it("explore_start map path must exist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-mcp-map-"));
    const configPath = join(dir, "clickmonkey.json");
    try {
      saveConfig(configPath, emptyConfig("http://127.0.0.1:4173/"));
      const host = createMcpHost();
      const result = await handleExploreStart(host, {
        config: configPath,
        map: join(dir, "missing-map.json"),
      });
      assert.equal(result.isError, true);
      assert.match(textOf(result), /map not found/);
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
      assert.match(text, /guide: clickmonkey:\/\/guide/);
      assert.match(text, /spec: clickmonkey:\/\/spec/);
      assert.match(text, /clickmonkey/);
      assert.match(text, /explore_tester/);
      assert.match(text, /spec_writer/);
      assert.match(text, /map is thin \(0 pages\)/);
      assert.match(text, /clickmonkey map/);
      assert.doesNotMatch(text, /^reach:/m);
      assert.doesNotMatch(text, /sitemap \(open only where via says open\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("explore_start does not nudge a map that already has pages", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-mcp-start-fat-"));
    const configPath = join(dir, "clickmonkey.json");
    try {
      saveConfig(configPath, {
        ...emptyConfig("http://127.0.0.1:4173/", "fixture"),
        map: PageModel.parse({
          schemaVersion: 1,
          app: "fixture",
          generation: 0,
          pages: [
            {
              id: "home",
              path: "/",
              params: [],
              ready: { by: "testId", value: "home" },
              surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
            },
            {
              id: "customers",
              path: "/customers",
              params: [],
              ready: { by: "testId", value: "customers" },
              surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
            },
          ],
        }),
      });
      const host: McpHost = {
        createSession: () => stubSession({ start: async () => visitOf() }),
      };
      const result = await handleExploreStart(host, { config: configPath });
      assert.equal(result.isError, undefined);
      assert.doesNotMatch(textOf(result), /map is thin/);
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

  it("explore_findings lists persisted folders", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-mcp-findings-"));
    const folder = join(dir, "findings", "fnd_1_httpError");
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "finding.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        id: "fnd_1_httpError",
        kind: "httpError",
        severity: "critical",
        message: "HTTP 403 GET /applications",
        tapePath: join(folder, "replay.log"),
        stepIndex: 1,
        url: "http://127.0.0.1:3000/applications",
      })}\n`,
    );
    try {
      const host: McpHost = { session: stubSession({ outDir: dir }) };
      const result = await handleExploreFindings(host);
      assert.equal(result.isError, undefined);
      assert.match(textOf(result), /fnd_1_httpError/);
      assert.match(textOf(result), /httpError/);
      assert.match(textOf(result), /\/applications/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("explore_finding files screenshot ui with hostFinding", async () => {
    const visit = visitOf();
    let seen: { line?: string; opts?: { hostFinding?: boolean; severity?: string } } = {};
    const host: McpHost = {
      session: stubSession({
        step: async (line, opts) => {
          seen = { line, opts };
          return {
            ok: true,
            result: {
              ok: true,
              view: visit.view,
              finding: {
                schemaVersion: 1,
                id: "fnd_0_uiIssue",
                kind: "uiIssue",
                severity: "major",
                message: "overlap",
                tapePath: "t",
                stepIndex: 0,
              },
              findingCreated: true,
            },
            visit,
            newProductFinding: true,
          };
        },
      }),
    };
    const result = await handleExploreFinding(host, { message: "cards overlap" });
    assert.equal(result.isError, undefined);
    assert.match(textOf(result), /finding: fnd_0_uiIssue/);
    assert.match(seen.line ?? "", /screenshot ui/);
    assert.equal(seen.opts?.hostFinding, true);
    assert.equal(seen.opts?.severity, "major");
  });

  it("finishExplore is not an error when no session is live", async () => {
    const result = await finishExplore(createMcpHost(), { report: true });
    assert.equal(result.isError, undefined);
    assert.match(textOf(result), /not started/);
  });

  it("explore_finish writes host summary into the report", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-mcp-summary-"));
    const configPath = join(dir, "clickmonkey.json");
    const outDir = join(dir, "run");
    mkdirSync(outDir, { recursive: true });
    saveConfig(configPath, emptyConfig("http://127.0.0.1:4173/"));
    const sessionPath = join(outDir, "session.md");
    const logPath = join(outDir, "log.txt");
    try {
      const host: McpHost = {
        session: stubSession({
          outDir,
          configPath,
          config: emptyConfig("http://127.0.0.1:4173/"),
          finish: async () => {
            writeSessionMd({
              path: sessionPath,
              startedAt: Date.parse("2026-01-02T03:04:05.000Z"),
              charter: "walk the form",
              config: emptyConfig("http://127.0.0.1:4173/"),
              findings: [],
              notes: [],
              goods: [],
            });
            writeFileSync(logPath, "open home\n");
            return emptyResult(sessionPath, logPath);
          },
        }),
      };
      const result = await handleExploreFinish(host, {
        summary: "Applications 403 is real; customer XSS rows are leftover --nasty.",
        extra: "Ignored dirty customer names.",
      });
      assert.equal(result.isError, undefined);
      assert.match(textOf(result), /report:/);
      assert.equal(host.reported, true);
      const reportLine = textOf(result)
        .split("\n")
        .find((l) => l.startsWith("report: "));
      assert.ok(reportLine);
      const mdPath = reportLine.slice("report: ".length);
      const md = readFileSync(mdPath, "utf8");
      assert.match(md, /Applications 403 is real/);
      assert.match(md, /Ignored dirty customer names/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("spec_list lists clickmonkey/specs/ paths from the leash directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-mcp-speclist-"));
    const configPath = join(dir, "clickmonkey.json");
    try {
      saveConfig(configPath, emptyConfig("http://127.0.0.1:4173/", "fixture"));
      const specs = specsDir(configPath);
      mkdirSync(specs, { recursive: true });
      writeFileSync(
        join(specs, "add-customer.md"),
        `# Add customer requires a name\n\n\`\`\`clickmonkey\nopen home\nclick page.go\n\`\`\`\n`,
      );
      const host = createMcpHost({ config: configPath });
      const result = await handleSpecList(host);
      assert.equal(result.isError, undefined);
      assert.equal(textOf(result), "clickmonkey/specs/add-customer.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("spec_check reports a missing id", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-mcp-speccheck-"));
    const configPath = join(dir, "clickmonkey.json");
    try {
      saveConfig(configPath, {
        ...emptyConfig("http://127.0.0.1:4173/", "fixture"),
        map: PageModel.parse({
          schemaVersion: 1,
          app: "fixture",
          generation: 0,
          pages: [
            {
              id: "home",
              path: "/",
              params: [],
              ready: { by: "testId", value: "home" },
              surfaces: [
                {
                  id: "page",
                  kind: "page",
                  fields: [],
                  actions: [{ id: "go", by: "testId", value: "go", status: "ok" }],
                },
              ],
            },
          ],
        }),
      });
      const specs = specsDir(configPath);
      mkdirSync(specs, { recursive: true });
      writeFileSync(
        join(specs, "login.md"),
        `# Login\n\n\`\`\`clickmonkey\nopen home\nclick page.nope\n\`\`\`\n`,
      );
      const host = createMcpHost({ config: configPath });
      const result = await handleSpecCheck(host, { path: "login.md" });
      assert.equal(result.isError, true);
      assert.match(textOf(result), /MISS specs\/login\.md  Login  missing: page\.nope/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("spec_check is ok when every cited id is on the map", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-mcp-specok-"));
    const configPath = join(dir, "clickmonkey.json");
    try {
      saveConfig(configPath, {
        ...emptyConfig("http://127.0.0.1:4173/", "fixture"),
        map: PageModel.parse({
          schemaVersion: 1,
          app: "fixture",
          generation: 0,
          pages: [
            {
              id: "home",
              path: "/",
              params: [],
              ready: { by: "testId", value: "home" },
              surfaces: [
                {
                  id: "page",
                  kind: "page",
                  fields: [],
                  actions: [{ id: "go", by: "testId", value: "go", status: "ok" }],
                },
              ],
            },
          ],
        }),
      });
      const specs = specsDir(configPath);
      mkdirSync(specs, { recursive: true });
      writeFileSync(join(specs, "ok.md"), `# Go\n\n\`\`\`clickmonkey\nopen home\nclick page.go\n\`\`\`\n`);
      const host = createMcpHost({ config: configPath });
      const result = await handleSpecCheck(host, { path: "ok.md" });
      assert.equal(result.isError, undefined);
      assert.match(textOf(result), /OK\s+specs\/ok\.md  Go/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("spec_check errors when the spec is missing, the map is empty, or there is no fence", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-mcp-specerr-"));
    const configPath = join(dir, "clickmonkey.json");
    try {
      saveConfig(configPath, emptyConfig("http://127.0.0.1:4173/", "fixture"));
      const host = createMcpHost({ config: configPath });
      const missing = await handleSpecCheck(host, { path: "nope.md" });
      assert.equal(missing.isError, true);
      assert.match(textOf(missing), /spec not found: nope\.md/);

      const specs = specsDir(configPath);
      mkdirSync(specs, { recursive: true });
      writeFileSync(join(specs, "empty.md"), "# No fence\n\nJust prose.\n");
      const noMap = await handleSpecCheck(host, { path: "empty.md" });
      assert.equal(noMap.isError, true);
      assert.match(textOf(noMap), /map has no pages \(run inspect\)/);

      saveConfig(configPath, {
        ...emptyConfig("http://127.0.0.1:4173/", "fixture"),
        map: PageModel.parse({
          schemaVersion: 1,
          app: "fixture",
          generation: 0,
          pages: [
            {
              id: "home",
              path: "/",
              params: [],
              ready: { by: "testId", value: "home" },
              surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
            },
          ],
        }),
      });
      const noFence = await handleSpecCheck(host, { path: "empty.md" });
      assert.equal(noFence.isError, true);
      assert.match(textOf(noFence), /NONE specs\/empty\.md  \(no clickmonkey fence\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("spec_save writes a compacted fence from lastWalk and increments the slug", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-mcp-specsave-"));
    const configPath = join(dir, "clickmonkey.json");
    try {
      saveConfig(configPath, emptyConfig("http://127.0.0.1:4173/", "fixture"));
      const host = createMcpHost({ config: configPath });
      host.lastWalk = {
        log: {
          schemaVersion: 1,
          comments: [],
          steps: [
            { kind: "open", page: "home" },
            { kind: "click", surface: "page", id: "go" },
            { kind: "expectPath", path: "/" },
          ],
          usedLocators: {},
          result: "passed",
        },
        logPath: join(dir, "log.txt"),
        configPath,
      };
      const first = await handleSpecSave(host, { title: "Go home" });
      assert.equal(first.isError, undefined);
      assert.match(textOf(first), /spec: clickmonkey\/specs\/go-home\.md/);
      assert.match(textOf(first), /steps: 3/);
      assert.match(textOf(first), /spec_run/);
      const body = readFileSync(join(specsDir(configPath), "go-home.md"), "utf8");
      assert.match(body, /^# Go home/m);
      assert.match(body, /```clickmonkey/);
      assert.match(body, /^open home$/m);
      assert.match(body, /^click page\.go$/m);

      const second = await handleSpecSave(host, { title: "Go home" });
      assert.equal(second.isError, undefined);
      assert.match(textOf(second), /spec: clickmonkey\/specs\/go-home-2\.md/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("spec_save prefers a live tape over lastWalk, and lastWalk when the live tape is idle", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-mcp-specsave-live-"));
    const configPath = join(dir, "clickmonkey.json");
    try {
      saveConfig(configPath, emptyConfig("http://127.0.0.1:4173/", "fixture"));
      const last = {
        log: {
          schemaVersion: 1,
          comments: [],
          steps: [
            { kind: "open" as const, page: "home" },
            { kind: "click" as const, surface: "page", id: "saved" },
            { kind: "expectPath" as const, path: "/" },
          ],
          usedLocators: {},
          result: "passed" as const,
        },
        logPath: join(dir, "old-log.txt"),
        configPath,
      };
      const liveLog = {
        schemaVersion: 1 as const,
        comments: [] as string[],
        steps: [
          { kind: "open" as const, page: "home" },
          { kind: "click" as const, surface: "page", id: "live" },
          { kind: "expectPath" as const, path: "/" },
        ],
        usedLocators: {},
        result: "passed" as const,
      };
      const host: McpHost = {
        configFlag: configPath,
        lastWalk: last,
        session: stubSession({
          started: true,
          configPath,
          tape: () => ({ log: liveLog, logPath: join(dir, "live-log.txt") }),
        }),
      };
      const live = await handleSpecSave(host, { title: "Live walk", file: "from-live.md" });
      assert.equal(live.isError, undefined);
      assert.match(readFileSync(join(specsDir(configPath), "from-live.md"), "utf8"), /click page\.live/);

      host.session = stubSession({
        started: true,
        configPath,
        tape: () => ({ log: emptyResult("", "").log, logPath: join(dir, "empty-log.txt") }),
      });
      const fallback = await handleSpecSave(host, { title: "Saved walk", file: "from-last.md" });
      assert.equal(fallback.isError, undefined);
      assert.match(readFileSync(join(specsDir(configPath), "from-last.md"), "utf8"), /click page\.saved/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("spec_save errors when there is no walk and when the tape is empty", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-mcp-specsave-empty-"));
    const configPath = join(dir, "clickmonkey.json");
    try {
      saveConfig(configPath, emptyConfig("http://127.0.0.1:4173/", "fixture"));
      const none = await handleSpecSave(createMcpHost({ config: configPath }), { title: "Nope" });
      assert.equal(none.isError, true);
      assert.match(textOf(none), /no walk to freeze/);

      const host = createMcpHost({ config: configPath });
      host.lastWalk = {
        log: emptyResult("", "").log,
        logPath: join(dir, "log.txt"),
        configPath,
      };
      const empty = await handleSpecSave(host, { title: "Nope" });
      assert.equal(empty.isError, true);
      assert.match(textOf(empty), /empty fence/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("spec_run live-replays via the playbook and refuses a live explore session", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-mcp-specrun-"));
    const configPath = join(dir, "clickmonkey.json");
    try {
      saveConfig(configPath, {
        ...emptyConfig("http://127.0.0.1:4173/", "fixture"),
        map: PageModel.parse({
          schemaVersion: 1,
          app: "fixture",
          generation: 0,
          pages: [
            {
              id: "home",
              path: "/",
              params: [],
              ready: { by: "testId", value: "home" },
              surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
            },
          ],
        }),
      });
      const specs = specsDir(configPath);
      mkdirSync(specs, { recursive: true });
      writeFileSync(join(specs, "ok.md"), `# Go\n\n\`\`\`clickmonkey\nopen home\n\`\`\`\n`);
      let seen: string[] | undefined;
      const host: McpHost = {
        configFlag: configPath,
        runSpecs: async (opts) => {
          seen = opts.files;
          return {
            ok: true,
            cases: [{ file: opts.files[0]!, title: "Go", ok: true, findingCount: 0 }],
            logPath: join(dir, "log.txt"),
            mdPath: join(dir, "spec-results.md"),
            findingErrors: 0,
          };
        },
      };
      const result = await handleSpecRun(host, { path: "ok.md" });
      assert.equal(result.isError, undefined);
      assert.ok(seen?.[0]?.endsWith("ok.md"));
      assert.match(textOf(result), /PASS/);
      assert.match(textOf(result), /mdPath:/);

      host.session = stubSession({ started: true });
      const blocked = await handleSpecRun(host, {});
      assert.equal(blocked.isError, true);
      assert.match(textOf(blocked), /explore_finish before spec_run/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("guide names the five monkeys and MCP spec_save/spec_run", () => {
    assert.match(CLICKMONKEY_GUIDE, /Five monkeys/);
    assert.match(CLICKMONKEY_GUIDE, /clickmonkey map/);
    assert.match(CLICKMONKEY_GUIDE, /clickmonkey unleash/);
    assert.match(CLICKMONKEY_GUIDE, /clickmonkey nasty/);
    assert.match(CLICKMONKEY_GUIDE, /clickmonkey explore/);
    assert.match(CLICKMONKEY_GUIDE, /\*\*mcp\*\*/);
    assert.match(CLICKMONKEY_GUIDE, /Not `clickmonkey explore`/);
    assert.match(CLICKMONKEY_GUIDE, /clickmonkey spec/);
    assert.match(CLICKMONKEY_GUIDE, /clickmonkey replay/);
    assert.match(CLICKMONKEY_GUIDE, /explore_start/);
    assert.match(CLICKMONKEY_GUIDE, /spec_writer/);
    assert.match(CLICKMONKEY_GUIDE, /clickmonkey:\/\/spec/);
    assert.match(CLICKMONKEY_GUIDE, /spec_save/);
    assert.match(CLICKMONKEY_GUIDE, /spec_run/);
    assert.match(CLICKMONKEY_GUIDE, /## Spec and replay \(not monkeys\)/);
    assert.ok(CLICKMONKEY_GUIDE.split("\n").length <= 40, "guide should stay short");
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
