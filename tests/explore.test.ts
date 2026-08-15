import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createExploreBrain } from "../src/brains/explore.js";
import type { ChatClient } from "../src/brains/chat.js";
import { saveConfig } from "../src/persist/config.js";
import { cannedReport } from "../src/reports/canned.js";
import { Config } from "../src/schema/config.js";
import { Finding } from "../src/schema/finding.js";
import type { View } from "../src/schema/view.js";
import { runExplore } from "../src/playbooks/explore.js";
import { serveSite } from "./helpers/fixture-server.js";

const homeMap = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/models/valid-home.json", import.meta.url)), "utf8"),
) as unknown;

function viewOf(partial: Partial<View> = {}): View {
  return {
    page: "home",
    surface: "page",
    stack: ["page"],
    shown: [],
    actions: [{ id: "openCreate" }],
    ...partial,
  };
}

describe("createExploreBrain", () => {
  it("falls back to screenshot when the model reply is not a DSL line", async () => {
    const brain = createExploreBrain({
      chat: async () => "not-json",
      charter: "walk the form",
      skills: "one step",
      startedAt: Date.now(),
    });
    const decision = await brain.decide({ view: viewOf(), stepsUsed: 0 });
    assert.equal(decision.line, "screenshot");
  });

  it("does not put HTML or ref=e in the prompt", async () => {
    let prompt = "";
    const brain = createExploreBrain({
      chat: async ({ messages }) => {
        prompt = messages.map((m) => m.content).join("\n");
        return JSON.stringify({ line: "screenshot" });
      },
      charter: "walk the form",
      skills: "one step",
      startedAt: Date.now(),
    });
    await brain.decide({
      view: viewOf({
        content: '- button "Create" [ref=e12]\n<main data-testid="home">leak</main>',
      }),
      stepsUsed: 0,
    });
    assert.equal(prompt.includes("<main"), false);
    assert.equal(prompt.includes("ref=e"), false);
    assert.match(prompt, /openCreate/);
  });
});

describe("runExplore", () => {
  it("writes session.md, keeps HTML out of the brain, and appends finding explain text", async () => {
    const { baseUrl, close } = await serveSite("accepts-empty");
    const tmp = mkdtempSync(join(tmpdir(), "cm-explore-"));
    const configPath = join(tmp, "clickmonkey.json");
    const outDir = join(tmp, "out");
    const prompts: string[] = [];
    let n = 0;
    const script = [
      JSON.stringify({ line: "screenshot", note: "baseline" }),
      JSON.stringify({ line: "click page.openCreate" }),
      JSON.stringify({ line: 'fill createDialog.name ""' }),
      JSON.stringify({ line: "click createDialog.submit" }),
      JSON.stringify({ line: 'screenshot ui "empty name accepted"' }),
    ];
    const mockChat: ChatClient = async ({ messages }) => {
      const text = messages.map((m) => m.content).join("\n");
      prompts.push(text);
      if (/why it matters/i.test(text) || /how to retest/i.test(text)) {
        return "What happened: submit accepted an empty name.\nWhy it matters: required fields should reject blank input.\nHow to retest: open create and submit with an empty name.";
      }
      return script[Math.min(n++, script.length - 1)] ?? JSON.stringify({ line: "screenshot" });
    };
    try {
      const config = Config.parse({
        url: baseUrl,
        map: homeMap,
        brain: { baseUrl: "http://127.0.0.1:9", model: "mock-explore" },
      });
      saveConfig(configPath, config);
      const result = await runExplore({
        config,
        configPath,
        outDir,
        steps: 5,
        minutes: 5,
        chat: mockChat,
      });
      assert.ok(existsSync(join(outDir, "session.md")), "session.md");
      const session = readFileSync(join(outDir, "session.md"), "utf8");
      assert.match(session, /^# Explore session — /);
      assert.match(session, /## Configuration/);
      assert.match(session, /## Runtime errors/);
      assert.match(session, /## Critical \/ Major \/ Minor \/ Suggestion/);
      assert.match(session, /## Notes/);
      assert.match(session, /## Positive observations/);
      assert.match(session, /mock-explore/);
      assert.ok(existsSync(result.logPath), "log.txt");
      for (const prompt of prompts) {
        assert.equal(prompt.includes("<main"), false, prompt.slice(0, 200));
        assert.equal(prompt.includes("ref=e"), false, prompt.slice(0, 200));
      }
      const findingsRoot = join(outDir, "findings");
      assert.ok(existsSync(findingsRoot), "findings folder");
      const ids = readdirSync(findingsRoot).filter((name) => name.startsWith("fnd_"));
      assert.ok(ids.length > 0, "expected a finding folder");
      const id = ids[0]!;
      const report = readFileSync(join(findingsRoot, id, "report.md"), "utf8");
      const finding = Finding.parse(
        JSON.parse(readFileSync(join(findingsRoot, id, "finding.json"), "utf8")) as unknown,
      );
      assert.match(report, /UI issue captured from an explicit screenshot step/);
      assert.ok(report.startsWith(cannedReport(finding).trim()));
      assert.match(report, /What happened: submit accepted an empty name/);
      assert.match(report, /Why it matters/);
      assert.match(report, /How to retest/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await close();
    }
  });
});
