import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAuthGateHref, isAuthGatePage, needsLeashReentry } from "../src/brains/unleash.js";
import type { createExecutor, RunState } from "../src/executor/run.js";
import {
  LEASH_REENTRY_TRIES,
  liveHref,
  recoverLeashIfNeeded,
  reenterLeash,
} from "../src/playbooks/leash.js";
import { resetToSeed } from "../src/playbooks/seed.js";
import { Config } from "../src/schema/config.js";

const loginPages = [
  { id: "login", path: "/login" },
  { id: "home", path: "/" },
];

function stateOf(opts: {
  pageId: string;
  href: string;
  intro?: string[];
  afterGoto?: (next: string) => string;
  onGoto?: (url: string) => void;
}): RunState {
  let href = opts.href;
  const config = Config.parse({
    url: "http://127.0.0.1/login",
    intro: opts.intro ?? ["fill login.user $CLICKMONKEY_USER", "click login.submit"],
    map: {
      schemaVersion: 1,
      app: "app",
      pages: [
        {
          id: "login",
          path: "/login",
          ready: { by: "testId", value: "body" },
          surfaces: [{ id: "login", kind: "page", fields: [], actions: [] }],
        },
        {
          id: "home",
          path: "/",
          ready: { by: "testId", value: "body" },
          surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
        },
      ],
    },
  });
  const state = {
    pageId: opts.pageId,
    surfaceStack: [opts.pageId],
    config,
    model: config.map,
    inIntro: false,
    page: {
      url: () => href,
      goto: async (next: string) => {
        opts.onGoto?.(next);
        href = opts.afterGoto?.(next) ?? next;
      },
    },
    afterStep: async (s: RunState) => {
      try {
        const path = new URL(href).pathname;
        s.pageId = path === "/login" || path === "/logout" ? "login" : "home";
      } catch {
        s.pageId = "home";
      }
    },
  } as unknown as RunState;
  return state;
}

function execOf(runIntro: () => Promise<void>, runLine?: (line: string) => Promise<{ view: { page: string } }>) {
  return {
    runIntro,
    runLine: runLine ?? (async () => {
      throw new Error("open seed should not run from the auth gate");
    }),
    runStep: async () => {
      throw new Error("unused");
    },
  } as unknown as ReturnType<typeof createExecutor>;
}

describe("auth gate", () => {
  it("matches logout rooms and live login/logout URLs", () => {
    assert.equal(isAuthGatePage("logout"), true);
    assert.equal(isAuthGatePage("sign_out"), true);
    assert.equal(isAuthGatePage("u_logout"), true);
    assert.equal(isAuthGateHref("http://127.0.0.1/login"), true);
    assert.equal(isAuthGateHref("http://127.0.0.1/Account/Logout"), true);
    assert.equal(isAuthGateHref("http://127.0.0.1/app#/login"), true);
    assert.equal(isAuthGateHref("http://127.0.0.1/home"), false);
    assert.equal(needsLeashReentry("home", "http://127.0.0.1/logout", loginPages), true);
    assert.equal(needsLeashReentry("home", "http://127.0.0.1/home", loginPages), false);
  });
});

describe("reenterLeash", () => {
  it("gotos the leash url then runs intro while still on login", async () => {
    const gotos: string[] = [];
    const state = stateOf({
      pageId: "login",
      href: "http://127.0.0.1/logout",
      onGoto: (url) => gotos.push(url),
    });
    let intro = 0;
    const kind = await reenterLeash(
      execOf(async () => {
        intro += 1;
        await state.page.goto("http://127.0.0.1/");
        state.pageId = "home";
      }),
      state,
    );
    assert.equal(gotos[0], "http://127.0.0.1/login");
    assert.equal(intro, 1);
    assert.equal(kind, "intro");
  });

  it("skips intro when goto already landed inside the app", async () => {
    const state = stateOf({
      pageId: "login",
      href: "http://127.0.0.1/logout",
      afterGoto: () => "http://127.0.0.1/",
    });
    let intro = 0;
    const kind = await reenterLeash(
      execOf(async () => {
        intro += 1;
      }),
      state,
    );
    assert.equal(intro, 0);
    assert.equal(kind, "already-in");
    assert.equal(state.pageId, "home");
  });
});

describe("recoverLeashIfNeeded", () => {
  it("is a no-op off the auth gate", async () => {
    const state = stateOf({ pageId: "home", href: "http://127.0.0.1/" });
    let intro = 0;
    const rec = await recoverLeashIfNeeded({
      pageId: "home",
      href: liveHref(state),
      pages: state.model.pages,
      exec: execOf(async () => {
        intro += 1;
      }),
      state,
      budget: { tries: 0 },
    });
    assert.equal(intro, 0);
    assert.deepEqual(rec, { recovered: false, gaveUp: false, attempted: false });
  });

  it("gives up after three failed intros and resets the budget on success", async () => {
    const state = stateOf({ pageId: "login", href: "http://127.0.0.1/login" });
    const budget = { tries: 0 };
    const echo: string[] = [];
    const fail = execOf(async () => {
      throw new Error("intro did not leave http://127.0.0.1/login");
    });
    for (let i = 0; i < LEASH_REENTRY_TRIES; i++) {
      const rec = await recoverLeashIfNeeded({
        pageId: "login",
        href: liveHref(state),
        pages: state.model.pages,
        exec: fail,
        state,
        budget,
        echo: (line) => echo.push(line),
      });
      assert.equal(rec.attempted, true);
      assert.equal(rec.recovered, false);
      assert.equal(rec.gaveUp, i === LEASH_REENTRY_TRIES - 1);
    }
    const gaveUp = await recoverLeashIfNeeded({
      pageId: "login",
      href: liveHref(state),
      pages: state.model.pages,
      exec: fail,
      state,
      budget,
      echo: (line) => echo.push(line),
    });
    assert.equal(gaveUp.gaveUp, true);
    assert.equal(gaveUp.attempted, false);
    assert.ok(echo.some((l) => l.includes("goto leash then intro")));
    assert.ok(echo.some((l) => l.includes("gave up")));

    const okState = stateOf({
      pageId: "login",
      href: "http://127.0.0.1/login",
      afterGoto: () => "http://127.0.0.1/",
    });
    const okBudget = { tries: 2 };
    const ok = await recoverLeashIfNeeded({
      pageId: "login",
      href: "http://127.0.0.1/login",
      pages: okState.model.pages,
      exec: execOf(async () => undefined),
      state: okState,
      budget: okBudget,
    });
    assert.equal(ok.recovered, true);
    assert.equal(okBudget.tries, 0);
  });
});

describe("resetToSeed", () => {
  it("re-enters via the leash instead of open from login", async () => {
    const state = stateOf({ pageId: "login", href: "http://127.0.0.1/logout" });
    let intro = 0;
    let opened = 0;
    const exec = execOf(
      async () => {
        intro += 1;
        await state.page.goto("http://127.0.0.1/");
        state.pageId = "home";
      },
      async () => {
        opened += 1;
        return { view: { page: "home" } };
      },
    );
    await assert.rejects(() => resetToSeed(exec, state, "home"));
    assert.equal(intro, 1);
    assert.equal(opened, 0);
  });
});
