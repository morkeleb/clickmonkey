import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkExploreLine,
  createExploreBrain,
  ExploreError,
  EXPLORE_DECIDE_RETRIES,
  EXPLORE_PROBE,
  isScreenshotLine,
  legalOpenIds,
  probeExploreChat,
  wouldRepeatCycle,
  parseExplorePlanReply,
  completeCurrentPlanItem,
  formatExplorePlan,
  recordPlanStep,
  isNewProductFinding,
  defaultExploreSkills,
  DEFAULT_EXPLORE_CHARTER,
} from "../src/brains/explore.js";
import { formatExplorePlanItemLine } from "../src/schema/ui.js";
import type { ChatMessage } from "../src/brains/chat.js";
import { saveConfig } from "../src/persist/config.js";
import { Config } from "../src/schema/config.js";
import type { View } from "../src/schema/view.js";
import { runExplore } from "../src/playbooks/explore.js";

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

describe("explore plan", () => {
  it("keeps legal page ids and drops invented ones", () => {
    const plan = parseExplorePlanReply(
      JSON.stringify({
        goal: "Walk invoicing",
        items: [
          { title: "Empty invoice name", page: "home" },
          { title: "Invented hop", page: "accounts_receivable_invoicing" },
          { title: "Runtime errors" },
        ],
      }),
      ["home"],
    );
    assert.ok(plan);
    assert.equal(plan.goal, "Walk invoicing");
    assert.equal(plan.items[0]?.page, "home");
    assert.equal(plan.items[0]?.status, "now");
    assert.equal(plan.items[1]?.page, undefined);
    assert.equal(plan.items[2]?.status, "pending");
    const next = completeCurrentPlanItem(plan, "done");
    assert.equal(next.items[0]?.status, "done");
    assert.equal(next.items[1]?.status, "now");
    assert.match(formatExplorePlan(next), /\[x\].*Empty invoice name/);
    assert.match(formatExplorePlan(next), /in progress/);
  });

  it("records stepCount and findingIds on the current item", () => {
    const plan = parseExplorePlanReply(
      JSON.stringify({
        goal: "Walk invoicing",
        items: [
          { title: "Empty invoice name", page: "home" },
          { title: "Runtime errors" },
        ],
      }),
      ["home"],
    );
    assert.ok(plan);
    const stepped = recordPlanStep(recordPlanStep(plan), { findingId: "fnd_2_uiIssue" });
    assert.equal(stepped.items[0]?.stepCount, 2);
    assert.deepEqual(stepped.items[0]?.findingIds, ["fnd_2_uiIssue"]);
    assert.match(formatExplorePlan(stepped), /in progress, 2 steps, 1 finding/);
    assert.equal(stepped.items[1]?.stepCount, 0);
    assert.deepEqual(stepped.items[1]?.findingIds, []);
    const done = completeCurrentPlanItem(stepped, "done");
    assert.equal(done.items[0]?.status, "done");
    assert.equal(done.items[0]?.stepCount, 2);
    assert.deepEqual(done.items[0]?.findingIds, ["fnd_2_uiIssue"]);
    assert.equal(done.items[1]?.status, "now");
    assert.equal(done.items[1]?.stepCount, 0);
  });

  it("treats only a newly persisted product finding as new", () => {
    const finding = { id: "fnd_1_uiIssue", kind: "uiIssue" };
    assert.equal(isNewProductFinding({ finding, findingCreated: true }), true);
    assert.equal(isNewProductFinding({ finding, findingCreated: false }), false);
    assert.equal(isNewProductFinding({ finding, findingCreated: true, currentFindingIds: ["fnd_1_uiIssue"] }), false);
    assert.equal(isNewProductFinding({ finding: { id: "fnd_0_unknownId", kind: "unknownId" }, findingCreated: true }), false);
  });

  it("formats plan coverage the same way as the findings report", () => {
    assert.equal(
      formatExplorePlanItemLine({
        id: "1",
        title: "Empty name",
        page: "invoices",
        status: "done",
        stepCount: 3,
        findingIds: ["fnd_1_uiIssue"],
      }),
      "- [x] Empty name (invoices) — 3 steps, 1 finding: fnd_1_uiIssue",
    );
    assert.equal(
      formatExplorePlanItemLine({
        id: "2",
        title: "Period close",
        status: "skipped",
        stepCount: 10,
        findingIds: [],
      }),
      "- [-] Period close — skipped, 10 steps",
    );
    assert.equal(
      formatExplorePlanItemLine({
        id: "3",
        title: "Credits",
        status: "now",
        stepCount: 2,
        findingIds: [],
      }),
      "- [>] Credits — in progress, 2 steps",
    );
    assert.equal(
      formatExplorePlanItemLine({ id: "4", title: "Reports", status: "pending", stepCount: 0, findingIds: [] }),
      "- [ ] Reports — never started",
    );
  });
});

describe("default explore pack", () => {
  it("teaches oracles and compounding notes", () => {
    const skills = defaultExploreSkills();
    assert.match(skills, /Each step should teach the next one/);
    assert.match(skills, /Claim:/);
    assert.match(skills, /Interruption:/);
    assert.match(skills, /done: true/);
    assert.match(DEFAULT_EXPLORE_CHARTER, /Explore .+ with .+ to discover/);
  });
});

describe("isScreenshotLine", () => {
  it("matches screenshot, screenshot ui, and labeled shots", () => {
    assert.equal(isScreenshotLine("screenshot"), true);
    assert.equal(isScreenshotLine('screenshot ui "overlap"'), true);
    assert.equal(isScreenshotLine("screenshot after-load"), true);
    assert.equal(isScreenshotLine("click page.openCreate"), false);
    assert.equal(isScreenshotLine(""), false);
  });
});

describe("probeExploreChat", () => {
  it("throws ExploreError when chat fails", async () => {
    await assert.rejects(
      () =>
        probeExploreChat({
          chat: async () => {
            throw new Error("fetch failed");
          },
          baseUrl: "http://127.0.0.1:9",
          model: "down",
        }),
      (err: unknown) => {
        assert.ok(err instanceof ExploreError);
        assert.match(err.message, /cannot reach the language model at http:\/\/127\.0\.0\.1:9/);
        assert.match(err.message, /model down/);
        assert.match(err.message, /fetch failed/);
        return true;
      },
    );
  });

  it("throws when the model returns an empty reply", async () => {
    await assert.rejects(
      () =>
        probeExploreChat({
          chat: async () => "  ",
          baseUrl: "http://127.0.0.1:11434/v1",
          model: "llama",
        }),
      /returned an empty reply/,
    );
  });

  it("sends the probe phrase and accepts a non-empty reply", async () => {
    let seen = "";
    await probeExploreChat({
      chat: async ({ messages }) => {
        seen = messages.map((m) => m.content).join("\n");
        return "pong";
      },
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "llama",
    });
    assert.match(seen, new RegExp(EXPLORE_PROBE));
  });
});

describe("checkExploreLine", () => {
  it("rejects click without surface.id and unmapped ids", () => {
    const view = viewOf();
    const noDot = checkExploreLine("click button_invoicing", view, { stepsUsed: 0, charter: "walk" });
    assert.equal(noDot.ok, false);
    if (!noDot.ok) assert.match(noDot.error, /expected surface\.id, got click button_invoicing/);
    const unmapped = checkExploreLine("click page.button_invoicing", view, { stepsUsed: 0, charter: "walk" });
    assert.equal(unmapped.ok, false);
    if (!unmapped.ok) assert.match(unmapped.error, /not a mapped action/);
    const ok = checkExploreLine("click page.openCreate", view, { stepsUsed: 0, charter: "walk" });
    assert.equal(ok.ok, true);
  });

  it("rejects an invented open when pages: is empty or the id is missing", () => {
    const empty = viewOf();
    assert.deepEqual(legalOpenIds(empty), ["home"]);
    const invented = checkExploreLine("open accounts_receivable_invoicing", empty, {
      stepsUsed: 1,
      charter: "walk invoicing",
    });
    assert.equal(invented.ok, false);
    if (!invented.ok) {
      assert.match(invented.error, /not in pages:/);
      assert.match(invented.error, /accounts_receivable_invoicing/);
    }
    const listed = viewOf({ pages: ["settings", "projects"] });
    assert.equal(checkExploreLine("open settings", listed, { stepsUsed: 1, charter: "walk" }).ok, true);
    const miss = checkExploreLine("open accounts_receivable_invoicing", listed, {
      stepsUsed: 1,
      charter: "walk",
    });
    assert.equal(miss.ok, false);
    if (!miss.ok) assert.match(miss.error, /use open settings/);
  });

  it("rejects a line that already failed", () => {
    const again = checkExploreLine("open accounts_receivable_invoicing", viewOf({ pages: ["home"] }), {
      stepsUsed: 2,
      charter: "walk",
      rejected: ["open accounts_receivable_invoicing"],
    });
    assert.equal(again.ok, false);
    if (!again.ok) assert.match(again.error, /already failed/);
  });

  it("rejects a hop/close ping-pong without banning the line forever", () => {
    assert.equal(
      wouldRepeatCycle(
        ["open accounts_receivable_period_close", "click page.button_close_period_close"],
        "open accounts_receivable_period_close",
      ),
      true,
    );
    const again = checkExploreLine("open accounts_receivable_period_close", viewOf({ pages: ["home", "accounts_receivable_period_close"] }), {
      stepsUsed: 2,
      charter: "walk",
      recent: ["open accounts_receivable_period_close", "click page.button_close_period_close"],
    });
    assert.equal(again.ok, false);
    if (!again.ok) {
      assert.match(again.error, /cycle/);
      assert.equal(again.ban, false);
    }
    const firstOpen = checkExploreLine("open accounts_receivable_period_close", viewOf({ pages: ["home", "accounts_receivable_period_close"] }), {
      stepsUsed: 0,
      charter: "walk",
      recent: [],
    });
    assert.equal(firstOpen.ok, true);
  });
});

describe("createExploreBrain", () => {
  it("re-asks after not-json and returns the next legal line", async () => {
    const replies = ["not-json", JSON.stringify({ line: "click page.openCreate" })];
    let calls = 0;
    const retries: string[] = [];
    const brain = createExploreBrain({
      chat: async () => replies[calls++] ?? "",
      charter: "walk the form",
      skills: "one step",
      startedAt: Date.now(),
      logRetry: (m) => retries.push(m),
    });
    const decision = await brain.decide({ view: viewOf(), stepsUsed: 0 });
    assert.equal(decision.line, "click page.openCreate");
    assert.equal(calls, 2);
    assert.equal(decision.line.includes("screenshot"), false);
    assert.match(retries.join("\n"), /brain retry:.*not-json/);
  });

  it("re-asks when the model repeats a hop/close cycle", async () => {
    let calls = 0;
    const retries: string[] = [];
    const brain = createExploreBrain({
      chat: async () => {
        calls += 1;
        if (calls === 1) return JSON.stringify({ line: "open accounts_receivable_period_close" });
        return JSON.stringify({ line: "click page.openCreate" });
      },
      charter: "walk period close",
      skills: "one step",
      startedAt: Date.now(),
      logRetry: (m) => retries.push(m),
    });
    const decision = await brain.decide({
      view: viewOf({
        pages: ["home", "accounts_receivable_period_close"],
        last: { step: "click page.button_close_period_close", ok: true },
      }),
      stepsUsed: 2,
      last: { ok: true },
      recent: ["open accounts_receivable_period_close", "click page.button_close_period_close"],
    });
    assert.equal(decision.line, "click page.openCreate");
    assert.equal(calls, 2);
    assert.match(retries.join("\n"), /cycle/);
  });

  it("re-asks after an invented open and does not return that open", async () => {
    let calls = 0;
    const retries: string[] = [];
    const brain = createExploreBrain({
      chat: async () => {
        calls += 1;
        if (calls === 1) return JSON.stringify({ line: "open accounts_receivable_invoicing" });
        return JSON.stringify({ line: "click page.openCreate" });
      },
      charter: "fix invoice rounding",
      skills: "Invoices / billing is a product area.",
      startedAt: Date.now(),
      logRetry: (m) => retries.push(m),
    });
    const decision = await brain.decide({ view: viewOf(), stepsUsed: 1 });
    assert.equal(decision.line, "click page.openCreate");
    assert.equal(calls, 2);
    assert.match(retries.join("\n"), /brain retry:.*not in pages:/);
  });

  it("does not retry an open that already came back unknownId", async () => {
    let calls = 0;
    const brain = createExploreBrain({
      chat: async () => {
        calls += 1;
        if (calls === 1) return JSON.stringify({ line: "open accounts_receivable_invoicing" });
        return JSON.stringify({ line: "click page.openCreate" });
      },
      charter: "walk invoicing",
      skills: "one step",
      startedAt: Date.now(),
      logRetry: () => undefined,
    });
    const decision = await brain.decide({
      view: viewOf({
        pages: ["home"],
        last: { step: "open accounts_receivable_invoicing", ok: false, finding: "unknownId" },
      }),
      stepsUsed: 2,
      last: { ok: false, finding: "unknownId" },
    });
    assert.equal(decision.line, "click page.openCreate");
    assert.equal(calls, 2);
  });

  it("re-asks after click without surface.id", async () => {
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
    const repair = calls[1]!.at(-1)?.content ?? "";
    assert.match(repair, /surface\.id/);
    assert.match(repair, /click page.openCreate/);
    assert.match(retries.join("\n"), /brain retry: expected surface\.id, got click button_invoicing/);
  });

  it("throws after retries are exhausted and never returns screenshot", async () => {
    let calls = 0;
    const brain = createExploreBrain({
      chat: async () => {
        calls += 1;
        return "not-json";
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

  it("retries after a chat throw and then returns a legal line", async () => {
    let calls = 0;
    const brain = createExploreBrain({
      chat: async () => {
        calls += 1;
        if (calls === 1) throw new Error("chat failed: 401 Unauthorized");
        return JSON.stringify({ line: "click page.openCreate" });
      },
      charter: "walk the form",
      skills: "one step",
      startedAt: Date.now(),
      logRetry: () => undefined,
    });
    const decision = await brain.decide({ view: viewOf(), stepsUsed: 3 });
    assert.equal(decision.line, "click page.openCreate");
    assert.equal(calls, 2);
  });

  it("retries a second screenshot then returns a click", async () => {
    let calls = 0;
    const brain = createExploreBrain({
      chat: async () => {
        calls += 1;
        if (calls === 1) return JSON.stringify({ line: "screenshot" });
        return JSON.stringify({ line: "click page.openCreate" });
      },
      charter: "walk the form",
      skills: "one step",
      startedAt: Date.now(),
      logRetry: () => undefined,
    });
    const decision = await brain.decide({
      view: viewOf({ last: { step: "screenshot", ok: true } }),
      stepsUsed: 1,
      last: { ok: true },
    });
    assert.equal(decision.line, "click page.openCreate");
    assert.equal(calls, 2);
  });

  it("throws when every retry is still a screenshot after a screenshot", async () => {
    const brain = createExploreBrain({
      chat: async () => JSON.stringify({ line: "screenshot" }),
      charter: "walk the form",
      skills: "one step",
      startedAt: Date.now(),
      logRetry: () => undefined,
    });
    await assert.rejects(
      () =>
        brain.decide({
          view: viewOf({ last: { step: "screenshot", ok: true } }),
          stepsUsed: 1,
          last: { ok: true },
        }),
      /last step was already a screenshot/,
    );
  });

  it("allows a screenshot when the last step was not a screenshot", async () => {
    const brain = createExploreBrain({
      chat: async () => JSON.stringify({ line: "screenshot" }),
      charter: "walk the form",
      skills: "one step",
      startedAt: Date.now(),
    });
    const decision = await brain.decide({
      view: viewOf({ last: { step: "click page.openCreate", ok: true } }),
      stepsUsed: 1,
      last: { ok: true },
    });
    assert.equal(decision.line, "screenshot");
  });

  it("allows a first-step screenshot when the charter is visual", async () => {
    const brain = createExploreBrain({
      chat: async () => JSON.stringify({ line: "screenshot" }),
      charter: "visual pass: look for overlap",
      skills: "one step",
      startedAt: Date.now(),
    });
    const decision = await brain.decide({ view: viewOf(), stepsUsed: 0 });
    assert.equal(decision.line, "screenshot");
  });

  it("tells the model not to screenshot twice in a row", async () => {
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
      view: viewOf({ last: { step: 'screenshot ui "cramped"', ok: true } }),
      stepsUsed: 1,
      last: { ok: true },
    });
    assert.match(prompt, /last step was already a screenshot/);
    assert.match(prompt, /Do not emit screenshot/);
  });

  it("asks for an oracle note the next step can use", async () => {
    let prompt = "";
    const brain = createExploreBrain({
      chat: async ({ messages }) => {
        prompt = messages.map((m) => m.content).join("\n");
        return JSON.stringify({ line: "click page.openCreate" });
      },
      charter: DEFAULT_EXPLORE_CHARTER,
      skills: defaultExploreSkills(),
      startedAt: Date.now(),
    });
    await brain.decide({ view: viewOf(), stepsUsed: 1 });
    assert.match(prompt, /<oracle>: <saw> → <next>/);
    assert.match(prompt, /One click is not enough/);
    assert.match(prompt, /Do not repeat a recent note/);
    assert.match(prompt, /Each step should teach the next one/);
    assert.match(prompt, /Claim:/);
  });
});

describe("runExplore preflight", () => {
  it("fails before opening a browser when the language model is unreachable", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "cm-explore-down-"));
    const configPath = join(tmp, "clickmonkey.json");
    const outDir = join(tmp, "out");
    try {
      const config = Config.parse({
        url: "http://127.0.0.1:9/",
        map: homeMap,
        brain: { baseUrl: "http://127.0.0.1:9", model: "down" },
      });
      saveConfig(configPath, config);
      await assert.rejects(
        () =>
          runExplore({
            config,
            configPath,
            outDir,
            steps: 1,
            minutes: 1,
          }),
        (err: unknown) => {
          assert.ok(err instanceof ExploreError);
          assert.match(err.message, /cannot reach the language model/);
          return true;
        },
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails before opening a browser when the API key env is missing", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "cm-explore-key-"));
    const configPath = join(tmp, "clickmonkey.json");
    const outDir = join(tmp, "out");
    const envName = "CLICKMONKEY_TEST_MISSING_EXPLORE_KEY";
    const previous = process.env[envName];
    delete process.env[envName];
    try {
      const config = Config.parse({
        url: "http://127.0.0.1:9/",
        map: homeMap,
        brain: { baseUrl: "http://127.0.0.1:9", model: "x", apiKeyEnv: envName },
      });
      saveConfig(configPath, config);
      await assert.rejects(
        () =>
          runExplore({
            config,
            configPath,
            outDir,
            steps: 1,
            minutes: 1,
          }),
        (err: unknown) => {
          assert.ok(err instanceof ExploreError);
          assert.match(err.message, new RegExp(`${envName}.*is not set`));
          return true;
        },
      );
    } finally {
      if (previous === undefined) delete process.env[envName];
      else process.env[envName] = previous;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
