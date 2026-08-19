import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { decideMap, decideUnleash, isLeaveAction, isWriteAction } from "../src/brains/unleash.js";
import { parseLine } from "../src/schema/dsl.js";
import type { View } from "../src/schema/view.js";
import { loadConfig } from "../src/persist/config.js";
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

describe("isLeaveAction", () => {
  it("treats workspace tab-close chrome as leave", () => {
    assert.equal(isLeaveAction({ id: "button_close_period_close" }), true);
    assert.equal(isLeaveAction({ id: "button_close_invoice_workspace" }), true);
    assert.equal(isLeaveAction({ id: "button_close_panel" }), true);
    assert.equal(isLeaveAction({ id: "logout" }), true);
    assert.equal(isLeaveAction({ id: "openCreate" }), false);
    assert.equal(isLeaveAction({ id: "button_invoicing" }), false);
    assert.equal(isLeaveAction({ id: "button_close_period_close", opens: "dialog" }), false);
  });
});

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

  it("hops to another page when the current view is empty", () => {
    const view = viewOf({
      page: "settings",
      pages: ["home", "settings"],
    });
    assert.equal(decideUnleash({ view, stepsUsed: 0 }).line, "open home");
    const afterHop = viewOf({
      page: "settings",
      pages: ["home", "settings"],
      last: { step: "open settings", ok: true },
    });
    assert.equal(decideUnleash({ view: afterHop, stepsUsed: 1 }).line, "screenshot");
  });

  it("prefers the main area over a navigation landmark", () => {
    const view = viewOf({
      actions: [{ id: "your_account" }, { id: "collections", nav: true }],
    });
    for (let i = 0; i < 20; i++) {
      const decision = decideUnleash({ view, stepsUsed: i }, () => 0.1);
      assert.equal(decision.line, "click page.your_account");
    }
  });

  it("stamps nav on a landmark click", () => {
    const view = viewOf({
      actions: [{ id: "collections", nav: true }],
    });
    assert.equal(decideUnleash({ view, stepsUsed: 0 }).line, "click page.collections nav");
  });
});

describe("map brain", () => {
  it("treats submit/save as writes and dialog openers as navigation", () => {
    assert.equal(isWriteAction({ id: "submit" }), true);
    assert.equal(isWriteAction({ id: "save", label: "Save changes" }), true);
    assert.equal(isWriteAction({ id: "add_to_cart" }), true);
    assert.equal(isWriteAction({ id: "button_sign_out" }), true);
    assert.equal(isWriteAction({ id: "logout", label: "Log out" }), true);
    assert.equal(isWriteAction({ id: "button_close_panel", label: "Close panel" }), true);
    assert.equal(isWriteAction({ id: "button_collapse_menu" }), true);
    assert.equal(isWriteAction({ id: "open_create", opens: "create" }), false);
    assert.equal(isWriteAction({ id: "about" }), false);
    assert.equal(isWriteAction({ id: "login" }), false);
    assert.equal(isWriteAction({ id: "sign_in" }), false);
  });

  it("never fills and never clicks write actions", () => {
    const view = viewOf({
      pages: ["home", "about_html"],
      shown: [{ id: "q", value: "", type: "text" }],
      actions: [{ id: "submit" }, { id: "about" }, { id: "open_create", opens: "create" }],
    });
    const legal = new Set(["about", "open_create"]);
    for (let i = 0; i < 80; i++) {
      const decision = decideMap({ view, stepsUsed: i });
      const parsed = parseLine(decision.line);
      assert.ok(parsed && !("comment" in parsed), decision.line);
      assert.notEqual(parsed.kind, "fill", decision.line);
      if (parsed.kind === "click") {
        assert.ok(legal.has(parsed.id), parsed.id);
      }
    }
  });

  it("walks live widgets even when the current page is not a hop target", () => {
    const view = viewOf({
      page: "login",
      pages: ["home"],
      actions: [{ id: "auth0_login_button" }],
    });
    for (let i = 0; i < 20; i++) {
      const decision = decideMap({ view, stepsUsed: i });
      assert.equal(decision.line, "click page.auth0_login_button");
    }
    const emptyEntry = viewOf({
      page: "login",
      pages: ["home"],
      actions: [],
    });
    assert.equal(decideMap({ view: emptyEntry, stepsUsed: 0 }).line, "open home");
    const stuck = viewOf({
      page: "callback",
      pages: [],
      actions: [],
    });
    assert.equal(decideMap({ view: stuck, stepsUsed: 0 }).line, "screenshot");
  });

  it("hops to another known page when only writes remain", () => {
    const view = viewOf({
      pages: ["home", "about_html"],
      shown: [{ id: "q", value: "", type: "text" }],
      actions: [{ id: "submit" }],
    });
    for (let i = 0; i < 20; i++) {
      const decision = decideMap({ view, stepsUsed: i });
      assert.equal(decision.line, "open about_html");
    }
  });

  it("prefers actions inside a navigation landmark", () => {
    const view = viewOf({
      pages: ["home"],
      actions: [{ id: "your_account" }, { id: "collections", nav: true }],
    });
    for (let i = 0; i < 20; i++) {
      const decision = decideMap({ view, stepsUsed: i }, () => 0.1);
      assert.equal(decision.line, "click page.collections nav");
    }
  });

  it("does not ping-pong open after a hop that found no widgets", () => {
    const view = viewOf({
      page: "home",
      pages: ["home", "settings"],
      last: { step: "open home", ok: true },
    });
    assert.equal(decideMap({ view, stepsUsed: 1 }).line, "screenshot");
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

describe("clickmonkey map", () => {
  it("walks nav links, grows the map, and never fills or submits", async () => {
    const { baseUrl, close } = await serveSite("nav");
    const tmp = mkdtempSync(join(tmpdir(), "cm-map-"));
    const cfg = join(tmp, "clickmonkey.json");
    try {
      const init = await run(["init", "--url", baseUrl, "--config", cfg]);
      assert.equal(init.status, 0, init.stderr);
      const out = join(tmp, "out");
      const result = await run(["map", "--steps", "12", "--config", cfg, "--out", out]);
      assert.ok(
        result.status === 0 || result.status === 1,
        `map exited ${result.status}\n${result.stdout}\n${result.stderr}`,
      );
      const logPath = join(out, "log.txt");
      assert.ok(existsSync(logPath), "log.txt");
      const log = readFileSync(logPath, "utf8");
      assert.doesNotMatch(log, /^fill /m);
      assert.doesNotMatch(log, /click page\.submit/);
      assert.match(log, /^(click|open) /m);
      const saved = loadConfig(cfg);
      const ids = saved.map.pages.map((p) => p.id);
      assert.ok(ids.includes("home"), `pages ${ids.join(",")}`);
      assert.ok(ids.includes("about_html"), `pages ${ids.join(",")}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      await close();
    }
  });
});
