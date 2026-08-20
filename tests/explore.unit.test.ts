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
  exampleExploreLine,
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
  formatPlanningCards,
  formatReachDag,
  draftExplorePlan,
  legalDirectOpenIds,
  parseExploreReply,
  PLAN_CONTEXT_MAX,
  pathParentPage,
  usefulExploreNote,
} from "../src/brains/explore.js";
import { formatExplorePlanItemLine } from "../src/schema/ui.js";
import { PageModel } from "../src/schema/page-model.js";
import type { ChatMessage } from "../src/brains/chat.js";
import { saveConfig } from "../src/persist/config.js";
import { Config } from "../src/schema/config.js";
import type { View } from "../src/schema/view.js";
import type { RunState } from "../src/executor/run.js";
import { createExecutor } from "../src/executor/run.js";
import { runExplore } from "../src/playbooks/explore.js";
import {
  applyExploreStep,
  exploreVisitOf,
  writeSessionMd,
  type ExploreWalkCtx,
} from "../src/playbooks/explore-session.js";

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

describe("formatPlanningCards", () => {
  const home = PageModel.parse(homeMap).pages[0]!;

  it("prints blurb, required fields, opens, and dialogs without locators", () => {
    const text = formatPlanningCards([
      { ...home, description: "workspace home" },
      {
        id: "invoices",
        path: "/invoices",
        params: [],
        ready: { by: "testId", value: "invoices" },
        description: "list and create invoices",
        surfaces: [
          {
            id: "page",
            kind: "page",
            fields: [
              { id: "name", required: true, type: "text", by: "testId", value: "name", status: "ok" },
              { id: "gone", required: false, type: "text", by: "testId", value: "gone", status: "unresolved" },
            ],
            actions: [
              { id: "create", by: "testId", value: "create", opens: "createDialog", status: "ok" },
              { id: "button_close_invoices", by: "testId", value: "close", status: "ok" },
            ],
          },
          {
            id: "createDialog",
            kind: "dialog",
            fields: [
              { id: "amount", required: true, type: "number", by: "testId", value: "amount", status: "ok" },
            ],
            actions: [{ id: "submit", by: "testId", value: "submit", status: "ok" }],
          },
        ],
      },
    ]);
    assert.match(text, /^sitemap \(open only where via says open\):/m);
    assert.match(text, /home — workspace home/);
    assert.match(text, /via: open home/);
    assert.match(text, /openCreate→createDialog/);
    assert.match(text, /createDialog \(name!, submit\)/);
    assert.match(text, /invoices — list and create invoices/);
    assert.match(text, /fields: name!/);
    assert.match(text, /actions: create→createDialog/);
    assert.match(text, /dialogs: createDialog \(amount!, submit\)/);
    assert.equal(text.includes("open-create"), false);
    assert.equal(text.includes("testId"), false);
    assert.equal(text.includes("button_close_invoices"), false);
    assert.equal(text.includes("gone"), false);
  });

  it("keeps legal id order and clips on a card boundary", () => {
    const invoices = {
      ...home,
      id: "invoices",
      path: "/invoices",
      description: "invoices",
    };
    const text = formatPlanningCards([home, invoices], { ids: ["invoices", "home"] });
    const inv = text.indexOf("invoices");
    const hom = text.indexOf("\nhome");
    assert.ok(inv > 0 && hom > inv);
    const clipped = formatPlanningCards([home, invoices], { ids: ["home", "invoices"], max: 180 });
    assert.match(clipped, /sitemap/);
    assert.match(clipped, /…$/);
    assert.equal(clipped.includes("invoices"), false);
  });

  it("marks nested pages as click-via, not direct open", () => {
    const invoices = {
      id: "invoices",
      path: "/invoices",
      params: [],
      ready: { by: "testId", value: "invoices" },
      description: "invoice list",
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [],
          actions: [
            { id: "open_row", by: "testId", value: "row", opens: "invoice_detail", status: "ok" },
          ],
        },
      ],
    };
    const detail = {
      id: "invoice_detail",
      path: "/invoices/:id",
      params: ["id"],
      ready: { by: "testId", value: "detail" },
      description: "one invoice",
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [{ id: "amount", required: true, type: "number", by: "testId", value: "amount", status: "ok" }],
          actions: [],
        },
      ],
    };
    const text = formatPlanningCards([home, invoices, detail]);
    assert.match(text, /invoices — invoice list\n  via: open invoices/);
    assert.match(text, /invoice_detail — one invoice\n  via: click open_row on invoices/);
    assert.equal(/invoice_detail[\s\S]*via: open invoice_detail/.test(text), false);
    const view = viewOf({ pages: ["home", "invoices", "invoice_detail"] });
    assert.deepEqual(legalDirectOpenIds(view, [home, invoices, detail]), ["home", "invoices"]);
    const blocked = checkExploreLine("open invoice_detail", view, {
      stepsUsed: 1,
      charter: "walk",
      pages: [home, invoices, detail],
    });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.match(blocked.error, /not a direct hop/);
    const ok = checkExploreLine("open invoices", view, {
      stepsUsed: 1,
      charter: "walk",
      pages: [home, invoices, detail],
    });
    assert.equal(ok.ok, true);
    const dag = formatReachDag([home, invoices, detail]);
    assert.match(dag, /^reach:/m);
    assert.match(dag, /open: home, invoices/);
    assert.match(dag, /click: invoices -open_row-> invoice_detail/);
    assert.doesNotMatch(dag, /open invoice_detail/);
  });

  it("uses path parent when no action.opens points at the nested page", () => {
    const invoices = {
      id: "invoices",
      path: "/invoices",
      params: [],
      ready: { by: "testId", value: "invoices" },
      description: "invoice list",
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [],
          actions: [{ id: "open_row", by: "testId", value: "row", status: "ok" }],
        },
      ],
    };
    const detail = {
      id: "invoice_detail",
      path: "/invoices/:id",
      params: ["id"],
      ready: { by: "testId", value: "detail" },
      description: "one invoice",
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [{ id: "amount", required: true, type: "number", by: "testId", value: "amount", status: "ok" }],
          actions: [],
        },
      ],
    };
    assert.equal(pathParentPage([home, invoices, detail], detail)?.id, "invoices");
    const text = formatPlanningCards([home, invoices, detail]);
    assert.match(text, /invoice_detail — one invoice\n  via: from invoices/);
    assert.equal(text.includes("via: click"), false);
    const dag = formatReachDag([home, invoices, detail]);
    assert.match(dag, /from: invoices -> invoice_detail/);
    const here = viewOf({ page: "invoice_detail", pages: ["home", "invoices", "invoice_detail"] });
    assert.deepEqual(legalDirectOpenIds(here, [home, invoices, detail]), ["home", "invoices"]);
    const ghost = viewOf({ pages: ["home", "missing_page"] });
    assert.deepEqual(legalDirectOpenIds(ghost, [home]), ["home"]);
  });
});

describe("draftExplorePlan", () => {
  it("feeds sitemap cards and refuses invented page ids", async () => {
    const pages = PageModel.parse(homeMap).pages;
    let prompt = "";
    const plan = await draftExplorePlan({
      chat: async ({ messages }) => {
        prompt = messages.map((m) => m.content).join("\n");
        return JSON.stringify({
          goal: "Explore create with empty name to discover validation",
          items: [
            { title: "Empty create name", page: "home" },
            { title: "Invented hop", page: "accounts_receivable_invoicing" },
          ],
        });
      },
      charter: DEFAULT_EXPLORE_CHARTER,
      skills: "",
      view: viewOf({ pages: ["home"] }),
      pages,
      logRetry: () => undefined,
    });
    assert.match(prompt, /page on an item may be any sitemap id/);
    assert.match(prompt, /The charter is the mission/);
    assert.match(prompt, /No architecture file\. Plan only from sitemap, charter, and oracles/);
    assert.match(prompt, /Empty: required name on create dialog/);
    assert.match(prompt, /Legal open ids \(direct hops only\):/);
    assert.match(prompt, /sitemap \(open only where via says open\):/);
    assert.match(prompt, /^reach:/m);
    assert.match(prompt, /dialog: home -openCreate-> createDialog/);
    assert.match(prompt, /openCreate→createDialog/);
    assert.match(prompt, /Current view \(start here\):/);
    assert.equal(prompt.includes("open-create"), false);
    assert.equal(plan.items[0]?.page, "home");
    assert.equal(plan.items[1]?.page, undefined);
  });

  it("shows nested sitemap cards and lets a plan item aim at them", async () => {
    const home = PageModel.parse(homeMap).pages[0]!;
    const invoices = {
      id: "invoices",
      path: "/invoices",
      params: [],
      ready: { by: "testId", value: "invoices" },
      description: "invoice list",
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [],
          actions: [
            { id: "open_row", by: "testId", value: "row", opens: "invoice_detail", status: "ok" },
          ],
        },
      ],
    };
    const detail = {
      id: "invoice_detail",
      path: "/invoices/:id",
      params: ["id"],
      ready: { by: "testId", value: "detail" },
      description: "one invoice",
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [{ id: "amount", required: true, type: "number", by: "testId", value: "amount", status: "ok" }],
          actions: [],
        },
      ],
    };
    let prompt = "";
    const plan = await draftExplorePlan({
      chat: async ({ messages }) => {
        prompt = messages.map((m) => m.content).join("\n");
        return JSON.stringify({
          goal: "Explore invoice detail with empty amount to discover silent save",
          items: [
            { title: "Empty amount on a real invoice", page: "invoice_detail" },
            { title: "Runtime errors" },
          ],
        });
      },
      charter: DEFAULT_EXPLORE_CHARTER,
      skills: "",
      view: viewOf({ pages: ["home", "invoices", "invoice_detail"] }),
      pages: [home, invoices, detail],
      logRetry: () => undefined,
    });
    assert.match(prompt, /invoice_detail — one invoice\n  via: click open_row on invoices/);
    assert.match(prompt, /Legal open ids \(direct hops only\): home, invoices/);
    assert.equal(prompt.includes("Legal open ids (direct hops only): home, invoices, invoice_detail"), false);
    assert.equal(plan.items[0]?.page, "invoice_detail");
    assert.match(prompt, /click: invoices -open_row-> invoice_detail/);
  });

  it("puts oracles in Look for and does not clip architecture behind them", async () => {
    let prompt = "";
    await draftExplorePlan({
      chat: async ({ messages }) => {
        prompt = messages.map((m) => m.content).join("\n");
        return JSON.stringify({
          goal: "Explore home with empty create to discover validation",
          items: [{ title: "Empty name", page: "home" }, { title: "Runtime" }],
        });
      },
      charter: DEFAULT_EXPLORE_CHARTER,
      oracles: `${"ORACLEPACK ".repeat(300)}Claim:`,
      skills: "ARCHITECTURE_MARKER how billing posts invoices",
      view: viewOf({ pages: ["home"] }),
      pages: PageModel.parse(homeMap).pages,
      logRetry: () => undefined,
    });
    assert.match(prompt, /Look for:/);
    assert.match(prompt, /Claim:/);
    assert.match(prompt, /ARCHITECTURE_MARKER/);
    const lookAt = prompt.indexOf("Look for:");
    const ctxAt = prompt.indexOf("Context:");
    assert.ok(lookAt >= 0 && ctxAt > lookAt);
    assert.ok(prompt.length > PLAN_CONTEXT_MAX);
  });
});

describe("default explore pack", () => {
  it("teaches oracles and compounding notes", () => {
    const skills = defaultExploreSkills();
    assert.match(skills, /The charter is the mission/);
    assert.match(skills, /Claim:/);
    assert.match(skills, /Interruption:/);
    assert.match(skills, /user would notice/);
    assert.match(skills, /done: true/);
    assert.match(skills, /Set `good`/);
    assert.match(skills, /blurb and required fields/);
    assert.match(skills, /quality ledger/);
    assert.match(skills, /Sight is context/);
    assert.match(skills, /Never invent widget ids from Sight/);
    assert.match(skills, /Prefer in-page buttons/);
    assert.match(DEFAULT_EXPLORE_CHARTER, /Explore .+ with .+ to discover/);
  });
});

describe("usefulExploreNote", () => {
  it("drops placeholder optional copied from the JSON example", () => {
    assert.equal(usefulExploreNote("optional"), undefined);
    assert.equal(usefulExploreNote("optional what worked"), undefined);
    assert.equal(usefulExploreNote("what worked"), undefined);
    assert.equal(usefulExploreNote("<oracle>: <saw> → <next>"), undefined);
    assert.equal(usefulExploreNote("Empty: tried empty value in search field"), "Empty: tried empty value in search field");
  });
});

describe("parseExploreReply", () => {
  it("keeps optional good observations", () => {
    const parsed = parseExploreReply(
      JSON.stringify({ line: "click page.openCreate", note: "Empty: try name", good: "dialog opened" }),
    );
    assert.equal(parsed?.line, "click page.openCreate");
    assert.equal(parsed?.note, "Empty: try name");
    assert.equal(parsed?.good, "dialog opened");
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
      oracles: defaultExploreSkills(),
      skills: "ARCHITECTURE_MARKER",
      startedAt: Date.now(),
    });
    await brain.decide({ view: viewOf(), stepsUsed: 1 });
    assert.match(prompt, /<oracle>: <saw> → <next>/);
    assert.match(prompt, /One click is not enough/);
    assert.match(prompt, /Do not repeat a recent note/);
    assert.match(prompt, /Look for:/);
    assert.match(prompt, /The charter is the mission/);
    assert.match(prompt, /Claim:/);
    assert.match(prompt, /user would notice/);
    assert.match(prompt, /Stay on that aim/);
    assert.match(prompt, /Context:\nARCHITECTURE_MARKER/);
  });

  it("puts Sight in the decide prompt when ctx.sight is set", async () => {
    let prompt = "";
    const contents: unknown[] = [];
    const brain = createExploreBrain({
      chat: async ({ messages }) => {
        prompt = messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
        for (const m of messages) contents.push(m.content);
        return JSON.stringify({ line: "click page.openCreate" });
      },
      charter: "walk the form",
      skills: "one step",
      startedAt: Date.now(),
    });
    await brain.decide({
      view: viewOf(),
      stepsUsed: 1,
      sight: "Login form with overlapping cards",
    });
    assert.match(prompt, /Sight: Login form with overlapping cards/);
    assert.match(prompt, /Current view:/);
    assert.ok(contents.every((c) => typeof c === "string"));
  });

  it("omits Sight from the decide prompt when ctx.sight is empty", async () => {
    let prompt = "";
    const brain = createExploreBrain({
      chat: async ({ messages }) => {
        prompt = messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
        return JSON.stringify({ line: "click page.openCreate" });
      },
      charter: "walk the form",
      skills: "one step",
      startedAt: Date.now(),
    });
    await brain.decide({ view: viewOf(), stepsUsed: 1, sight: "  " });
    assert.doesNotMatch(prompt, /Sight:/);
  });

  it("shows aim cards and via for the current plan item", async () => {
    const home = PageModel.parse(homeMap).pages[0]!;
    const invoices = {
      id: "invoices",
      path: "/invoices",
      params: [],
      ready: { by: "testId", value: "invoices" },
      description: "invoice list",
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [],
          actions: [
            { id: "open_row", by: "testId", value: "row", opens: "invoice_detail", status: "ok" },
          ],
        },
      ],
    };
    const detail = {
      id: "invoice_detail",
      path: "/invoices/:id",
      params: ["id"],
      ready: { by: "testId", value: "detail" },
      description: "one invoice",
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [{ id: "amount", required: true, type: "number", by: "testId", value: "amount", status: "ok" }],
          actions: [],
        },
      ],
    };
    let prompt = "";
    const brain = createExploreBrain({
      chat: async ({ messages }) => {
        prompt = messages.map((m) => m.content).join("\n");
        return JSON.stringify({
          line: "open invoices",
          note: "Empty: need a row to open detail",
          good: "invoice list rendered",
        });
      },
      charter: DEFAULT_EXPLORE_CHARTER,
      skills: "",
      pages: [home, invoices, detail],
      startedAt: Date.now(),
    });
    const plan = parseExplorePlanReply(
      JSON.stringify({
        goal: "Explore invoice detail with empty amount to discover silent save",
        items: [
          { title: "Empty amount on a real invoice", page: "invoice_detail" },
          { title: "Runtime" },
        ],
      }),
      ["home", "invoices", "invoice_detail"],
    );
    const decision = await brain.decide({
      view: viewOf({ pages: ["home", "invoices", "invoice_detail"] }),
      stepsUsed: 1,
      plan,
    });
    assert.match(prompt, /Aim \[Empty amount on a real invoice\]:/);
    assert.match(prompt, /aim \(follow via\):/);
    assert.match(prompt, /via: click open_row on invoices/);
    assert.match(prompt, /invoices -open_row-> invoice_detail/);
    assert.equal(decision.good, "invoice list rendered");
    assert.deepEqual(brain.getGoods(), ["invoice list rendered"]);
  });

  it("stamps Mode: form for a dialog with fields and submit", async () => {
    let prompt = "";
    const brain = createExploreBrain({
      chat: async ({ messages }) => {
        prompt = messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
        return JSON.stringify({ line: 'fill createDialog.name ""' });
      },
      charter: "walk the form",
      skills: "one step",
      startedAt: Date.now(),
    });
    const view = viewOf({
      surface: "createDialog",
      stack: ["page", "createDialog"],
      shown: [{ id: "name", value: "", type: "text" }],
      actions: [{ id: "submit" }, { id: "cancel", label: "Cancel" }],
    });
    const decision = await brain.decide({ view, stepsUsed: 0 });
    assert.match(prompt, /Mode: form/);
    assert.match(prompt, /finish the form or local button/);
    assert.equal(decision.mode, "form");
    assert.match(exampleExploreLine(view), /^fill createDialog\.name /);
  });

  it("stamps Mode: nav for a chrome-only view", async () => {
    let prompt = "";
    const brain = createExploreBrain({
      chat: async ({ messages }) => {
        prompt = messages.map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
        return JSON.stringify({ line: "click page.openCreate" });
      },
      charter: "walk the form",
      skills: "one step",
      startedAt: Date.now(),
    });
    const decision = await brain.decide({ view: viewOf(), stepsUsed: 1 });
    assert.match(prompt, /Mode: nav/);
    assert.doesNotMatch(prompt, /Mode: form/);
    assert.doesNotMatch(prompt, /finish the form or local button/);
    assert.equal(decision.mode, "nav");
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

function walkCtx(view: View, execRun?: () => Promise<void>): ExploreWalkCtx {
  const config = Config.parse({
    url: "http://127.0.0.1/",
    map: homeMap,
  });
  const state = {
    pageId: "home",
    model: config.map,
    config,
    outDir: "/tmp/out",
    surfaceStack: ["page"],
    log: { schemaVersion: 1, comments: [], steps: [], usedLocators: {} },
    usedLocators: {},
    pendingFindings: [],
  } as unknown as RunState;
  return {
    state,
    exec: {
      runLine: async () => {
        await execRun?.();
        throw new Error("exec.runLine should not run");
      },
      runStep: async () => {
        throw new Error("exec.runStep should not run");
      },
      runIntro: async () => undefined,
    } as ReturnType<typeof createExecutor>,
    charter: "walk",
    seedPageId: "home",
    view,
    stepsUsed: 0,
    refused: new Set(),
    recent: [],
    findings: [],
    notes: [],
    goods: [],
    outDir: "/tmp/out",
    config,
    startedAt: Date.now(),
    logPath: "/tmp/out/log.txt",
    sessionPath: "/tmp/out/session.md",
  };
}

describe("applyExploreStep", () => {
  it("returns a checkExploreLine refusal without executing", async () => {
    let ran = 0;
    const ctx = walkCtx(viewOf(), async () => {
      ran += 1;
      throw new Error("should not run");
    });
    const result = await applyExploreStep(ctx, "click button_invoicing");
    assert.equal(result.ok, false);
    assert.equal(ran, 0);
    assert.equal(ctx.stepsUsed, 0);
    if (!result.ok) {
      assert.match(result.error, /expected surface\.id, got click button_invoicing/);
      assert.equal(result.visit.view.last?.ok, false);
      assert.equal(result.visit.view.last?.step, "click button_invoicing");
    }
  });

  it("does not execute an invented open", async () => {
    let ran = 0;
    const ctx = walkCtx(viewOf({ pages: ["home"] }), async () => {
      ran += 1;
      throw new Error("should not run");
    });
    const result = await applyExploreStep(ctx, "open accounts_receivable_invoicing");
    assert.equal(result.ok, false);
    assert.equal(ran, 0);
    if (!result.ok) {
      assert.match(result.error, /not in pages:/);
      assert.equal(result.ban, undefined);
    }
    assert.equal(ctx.refused.has("open accounts_receivable_invoicing"), true);
  });

  it("does not ban a hop/close cycle forever", async () => {
    let ran = 0;
    const ctx = walkCtx(viewOf({ pages: ["home", "accounts_receivable_period_close"] }), async () => {
      ran += 1;
      throw new Error("should not run");
    });
    ctx.recent = ["open accounts_receivable_period_close", "click page.button_close_period_close"];
    ctx.stepsUsed = 2;
    const result = await applyExploreStep(ctx, "open accounts_receivable_period_close");
    assert.equal(result.ok, false);
    assert.equal(ran, 0);
    if (!result.ok) {
      assert.match(result.error, /cycle/);
      assert.equal(result.ban, false);
    }
    assert.equal(ctx.refused.has("open accounts_receivable_period_close"), false);
  });
});

describe("exploreVisitOf", () => {
  it("fills ready, legalOpen, writePolicy, and planLine", () => {
    const config = Config.parse({ url: "http://127.0.0.1/", map: homeMap });
    const state = {
      pageId: "home",
      model: config.map,
      config,
      outDir: "/tmp/out",
      lastScreenshotPath: "/tmp/out/shots/home.png",
      lastSight: "create dialog",
    } as unknown as RunState;
    const visit = exploreVisitOf(
      state,
      viewOf({ pages: ["home"], mode: "nav" }),
      {
        goal: "Walk home",
        items: [
          {
            id: "1",
            title: "Empty name",
            status: "now",
            stepCount: 0,
            findingIds: [],
          },
        ],
      },
    );
    assert.equal(visit.mode, "nav");
    assert.deepEqual(visit.ready, { by: "testId", value: "home" });
    assert.deepEqual(visit.legalOpen, ["home"]);
    assert.equal(visit.shot, "shots/home.png");
    assert.equal(visit.sight, "create dialog");
    assert.equal(visit.writePolicy, "validationOnly");
    assert.match(visit.planLine ?? "", /\[>\] Empty name/);
  });
});

describe("writeSessionMd", () => {
  it("prints empty model and baseUrl when config.brain is missing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cm-explore-session-md-"));
    const path = join(tmp, "session.md");
    try {
      writeSessionMd({
        path,
        startedAt: Date.parse("2026-01-02T03:04:05.000Z"),
        charter: "walk the form",
        config: Config.parse({ url: "http://127.0.0.1/", map: homeMap }),
        findings: [],
        notes: [],
        goods: [],
      });
      const body = readFileSync(path, "utf8");
      assert.match(body, /^- model: $/m);
      assert.match(body, /^- baseUrl: $/m);
      assert.match(body, /url: http:\/\/127\.0\.0\.1\//);
      assert.match(body, /walk the form/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

