import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createExploreBrain, ExploreError, EXPLORE_DECIDE_RETRIES } from "../src/brains/explore.js";
import type { ChatClient, ChatMessage } from "../src/brains/chat.js";
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
  it("does not put HTML or ref=e in the prompt", async () => {
    let prompt = "";
    const brain = createExploreBrain({
      chat: async ({ messages }) => {
        prompt = messages.map((m) => m.content).join("\n");
        return JSON.stringify({ line: "click page.openCreate" });
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
    assert.match(prompt, /surface\.id/);
    assert.match(prompt, /Never click x/);
    assert.match(prompt, /Never invent a page id/);
    assert.match(prompt, /Legal open ids:/);
  });

  it("re-asks after not-json and returns the next legal line", async () => {
    let calls = 0;
    const brain = createExploreBrain({
      chat: async () => {
        calls += 1;
        if (calls === 1) return "not-json";
        return JSON.stringify({ line: "click page.openCreate" });
      },
      charter: "walk the form",
      skills: "one step",
      startedAt: Date.now(),
      logRetry: () => undefined,
    });
    const decision = await brain.decide({ view: viewOf(), stepsUsed: 0 });
    assert.equal(decision.line, "click page.openCreate");
    assert.equal(calls, 2);
  });

  it("re-asks after click button_invoicing and does not screenshot", async () => {
    const calls: ChatMessage[][] = [];
    const retries: string[] = [];
    const brain = createExploreBrain({
      chat: async ({ messages }) => {
        calls.push(messages);
        if (calls.length === 1) return JSON.stringify({ line: "click button_invoicing" });
        return JSON.stringify({ line: "click page.openCreate" });
      },
      charter: "walk the form",
      skills: "one step",
      startedAt: Date.now(),
      logRetry: (m) => retries.push(m),
    });
    const decision = await brain.decide({ view: viewOf(), stepsUsed: 0 });
    assert.equal(decision.line, "click page.openCreate");
    assert.equal(calls.length, 2);
    assert.match(retries.join("\n"), /brain retry: expected surface\.id, got click button_invoicing/);
  });

  it("throws after retries fail and never returns screenshot", async () => {
    let calls = 0;
    const brain = createExploreBrain({
      chat: async () => {
        calls += 1;
        return JSON.stringify({ line: "click button_invoicing" });
      },
      charter: "walk the form",
      skills: "one step",
      startedAt: Date.now(),
      logRetry: () => undefined,
    });
    await assert.rejects(
      () => brain.decide({ view: viewOf(), stepsUsed: 0 }),
      (err: unknown) => {
        assert.ok(err instanceof ExploreError);
        assert.match(err.message, /did not get a legal DSL line/);
        assert.doesNotMatch(err.message, /"line": "screenshot"/);
        return true;
      },
    );
    assert.equal(calls, EXPLORE_DECIDE_RETRIES + 1);
  });

  it("retries after a chat throw and then returns a legal JSON line", async () => {
    let calls = 0;
    const brain = createExploreBrain({
      chat: async () => {
        calls += 1;
        if (calls === 1) throw new Error("fetch failed");
        return JSON.stringify({ line: "click page.openCreate" });
      },
      charter: "walk the form",
      skills: "one step",
      startedAt: Date.now(),
      logRetry: () => undefined,
    });
    const decision = await brain.decide({ view: viewOf(), stepsUsed: 0 });
    assert.equal(decision.line, "click page.openCreate");
    assert.equal(calls, 2);
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
      JSON.stringify({ line: "click page.openCreate" }),
      JSON.stringify({ line: 'fill createDialog.name ""' }),
      JSON.stringify({ line: "click createDialog.submit" }),
      JSON.stringify({ line: 'screenshot ui "empty name accepted"' }),
    ];
    const mockChat: ChatClient = async ({ messages }) => {
      const text = messages.map((m) => m.content).join("\n");
      prompts.push(text);
      if (/ClickMonkey explore probe/i.test(text)) return "pong";
      if (/ClickMonkey explore plan/i.test(text)) {
        return JSON.stringify({
          goal: "Try empty create",
          items: [
            { title: "Submit create with an empty name", page: "home" },
            { title: "Note runtime errors" },
          ],
        });
      }
      if (/page blurbs/i.test(text) || /one line, max 160/i.test(text)) {
        return "Home with a create-item dialog.";
      }
      if (/why it matters/i.test(text) || /how to retest/i.test(text)) {
        return "What happened: submit accepted an empty name.\nWhy it matters: required fields should reject blank input.\nHow to retest: open create and submit with an empty name.";
      }
      return script[Math.min(n++, script.length - 1)] ?? JSON.stringify({ line: "click page.openCreate" });
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
        steps: 4,
        minutes: 5,
        chat: mockChat,
      });
      assert.ok(existsSync(join(outDir, "session.md")), "session.md");
      const session = readFileSync(join(outDir, "session.md"), "utf8");
      assert.match(session, /^# Explore session — /);
      assert.match(session, /## Configuration/);
      assert.match(session, /## Runtime errors/);
      assert.match(session, /## Critical \/ Major \/ Minor \/ Suggestion/);
      assert.match(session, /## Plan/);
      assert.match(session, /Try empty create/);
      assert.match(session, /## Notes/);
      assert.match(session, /## Positive observations/);
      assert.match(session, /mock-explore/);
      assert.ok(existsSync(result.logPath), "log.txt");
      const presence = JSON.parse(readFileSync(join(outDir, "presence.json"), "utf8")) as {
        outline?: { charter?: string; now?: string; plan?: { goal?: string; items?: unknown[] } };
      };
      assert.match(presence.outline?.charter ?? "", /exploratory test/i);
      assert.ok(presence.outline?.now);
      assert.equal(presence.outline?.plan?.goal, "Try empty create");
      assert.ok((presence.outline?.plan?.items.length ?? 0) >= 2);
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

  it("never executes an invented open, even if the brain emits it", async () => {
    const { baseUrl, close } = await serveSite("accepts-empty");
    const tmp = mkdtempSync(join(tmpdir(), "cm-explore-open-"));
    const configPath = join(tmp, "clickmonkey.json");
    const outDir = join(tmp, "out");
    try {
      const config = Config.parse({
        url: baseUrl,
        map: homeMap,
        brain: { baseUrl: "http://127.0.0.1:9", model: "mock-explore" },
      });
      saveConfig(configPath, config);
      await assert.rejects(
        () =>
          runExplore({
            config,
            configPath,
            outDir,
            steps: 5,
            minutes: 5,
            chat: async () => "pong",
            brain: {
              name: "explore",
              decide: async () => ({ line: "open accounts_receivable_invoicing" }),
            },
          }),
        (err: unknown) => {
          assert.ok(err instanceof ExploreError);
          assert.match(err.message, /refused/);
          assert.match(err.message, /accounts_receivable_invoicing/);
          return true;
        },
      );
      const nav = join(outDir, "nav.jsonl");
      if (existsSync(nav)) {
        const text = readFileSync(nav, "utf8");
        assert.equal(text.includes('"type":"step"') && text.includes("accounts_receivable_invoicing"), false);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await close();
    }
  });
});
