import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  decideMap,
  decideUnleash,
  formSubmitAction,
  formDismissAction,
  inPageActions,
  isDismissAction,
  isLeaveAction,
  isPageHop,
  isRecordRowAction,
  isWriteAction,
  looksLikeNavWidget,
  sharedChromeIds,
  stayActions,
  FORM_DISMISS_RATE,
} from "../src/brains/unleash.js";
import { decisionLines } from "../src/brains/types.js";
import type { Page } from "../src/schema/page-model.js";
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
    assert.equal(isLeaveAction({ id: "button_close" }), false);
  });
});

describe("isDismissAction", () => {
  it("treats dialog close and cancel as dismiss, not submit", () => {
    assert.equal(isDismissAction({ id: "button_close" }), true);
    assert.equal(isDismissAction({ id: "button_close", label: "Close" }), true);
    assert.equal(isDismissAction({ id: "cancel", label: "Cancel" }), true);
    assert.equal(isDismissAction({ id: "button_cancel", opens: "add_customer" }), true);
    assert.equal(isDismissAction({ id: "create", label: "Create" }), false);
    assert.equal(
      formSubmitAction([
        { id: "button_close", label: "Close" },
        { id: "create", label: "Create" },
      ])?.id,
      "create",
    );
    assert.equal(FORM_DISMISS_RATE, 0.2);
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
        assert.equal(typeof parsed.value, "string");
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
      assert.equal(decision.mode, "nav");
    }
  });

  it("hops to another page when the current view is empty", () => {
    const view = viewOf({
      page: "settings",
      pages: ["home", "settings"],
    });
    const hop = decideUnleash({ view, stepsUsed: 0 });
    assert.equal(hop.line, "open home");
    assert.equal(hop.mode, "nav");
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

  it("ignores site chrome that is on most pages and hops when nothing local remains", () => {
    const pages: Page[] = ["home", "customers", "pipelines", "connectors"].map((id) => ({
      id,
      path: `/${id}`,
      params: [],
      ready: { by: "testId", value: id },
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [],
          actions: [
            { id: "link_customers", by: "role", value: "link", status: "ok" },
            { id: "link_pipelines", by: "role", value: "link", status: "ok" },
            ...(id === "customers"
              ? [{ id: "button_add_customer", by: "role", value: "button", status: "ok" as const }]
              : []),
          ],
        },
      ],
    }));
    assert.ok(sharedChromeIds(pages).has("link_customers"));
    assert.equal(sharedChromeIds(pages).has("button_add_customer"), false);
    const customers = viewOf({
      page: "customers",
      pages: pages.map((p) => p.id),
      actions: [
        { id: "link_customers", opens: "customers" },
        { id: "link_pipelines", opens: "pipelines" },
        { id: "button_add_customer" },
      ],
    });
    assert.deepEqual(
      inPageActions(customers, pages).map((a) => a.id),
      ["button_add_customer"],
    );
    for (let i = 0; i < 20; i++) {
      assert.equal(decideUnleash({ view: customers, stepsUsed: i, pages }).line, "click page.button_add_customer");
    }
    const chromeOnly = viewOf({
      page: "home",
      pages: pages.map((p) => p.id),
      actions: [
        { id: "link_customers", opens: "customers" },
        { id: "link_pipelines", opens: "pipelines" },
      ],
    });
    const hop = decideUnleash({ view: chromeOnly, stepsUsed: 0, pages });
    assert.match(hop.line, /^open /);
    assert.equal(hop.mode, "nav");
  });

  it("clicks an in-page button instead of a pile of unique record links", () => {
    const hops = Array.from({ length: 40 }, (_, i) => ({
      id: `link_row_${i}`,
      opens: `row_${i}`,
      role: "link",
    }));
    const view = viewOf({
      pages: hops.map((h) => h.opens),
      actions: [...hops, { id: "button_save_draft", label: "Save draft" }],
    });
    assert.deepEqual(
      stayActions(view).map((a) => a.id),
      ["button_save_draft"],
    );
    for (let i = 0; i < 40; i++) {
      assert.equal(decideUnleash({ view, stepsUsed: i }).line, "click page.button_save_draft");
    }
  });

  it("fills empty fields instead of clicking leftover hops", () => {
    const view = viewOf({
      shown: [
        { id: "name", value: "", type: "text" },
        { id: "email", value: "", type: "email" },
      ],
      actions: [
        { id: "link_overview", role: "link", opens: "home" },
        { id: "button_save", label: "Save" },
      ],
      pages: ["home"],
    });
    for (let i = 0; i < 20; i++) {
      const d = decideUnleash({ view, stepsUsed: i });
      assert.equal(d.mode, "form");
      const text = (d.lines ?? [d.line]).join("\n");
      assert.doesNotMatch(text, /link_overview/);
      assert.match(text, /^fill page\.(name|email) /m);
    }
  });

  it("treats nav landmarks and menu items as chrome, not in-page links", () => {
    assert.equal(looksLikeNavWidget({ id: "link_new_migration", role: "link" }), false);
    assert.equal(looksLikeNavWidget({ id: "link_customers" }), false);
    assert.equal(looksLikeNavWidget({ id: "link_customers", nav: true }), true);
    assert.equal(looksLikeNavWidget({ id: "menuitem_profile" }), true);
    assert.equal(looksLikeNavWidget({ id: "profile", role: "menuitem" }), true);
    assert.equal(looksLikeNavWidget({ id: "button_save_draft" }), false);
    assert.equal(isRecordRowAction({ id: "link_row_1" }), true);
    assert.equal(isRecordRowAction({ id: "customers_row_ab12" }), true);
    assert.equal(isRecordRowAction({ id: "customer_detail_action_customer_flow_setup" }), false);
    assert.equal(isPageHop({ id: "open_row", opens: "row_1" }, undefined, ["row_1"]), true);
    assert.equal(isPageHop({ id: "open_create", opens: "create" }, undefined, ["home"]), false);
  });

  it("picks an in-page New migration link hop ahead of sidebar chrome", () => {
    const view = viewOf({
      page: "customers_id1",
      pages: ["customers_id1", "customers_id1_flows_new", "home"],
      actions: [
        { id: "link_home", nav: true, role: "link", opens: "home" },
        {
          id: "customer_detail_action_customer_flow_setup",
          label: "New migration",
          opens: "customers_id1_flows_new",
        },
        { id: "link_new_migration", role: "link", label: "New migration" },
      ],
    });
    assert.deepEqual(
      stayActions(view).map((a) => a.id).sort(),
      ["customer_detail_action_customer_flow_setup", "link_new_migration"],
    );
    for (let i = 0; i < 20; i++) {
      assert.match(
        decideUnleash({ view, stepsUsed: i }).line,
        /customer_detail_action_customer_flow_setup|link_new_migration/,
      );
    }
  });

  it("with writePolicy allow fills empty fields then submits", () => {
    const view = viewOf({
      shown: [
        { id: "name", value: "", type: "text" },
        { id: "email", value: "", type: "email" },
      ],
      actions: [{ id: "submit" }, { id: "open_create" }],
    });
    const first = decideUnleash({ view, stepsUsed: 0, writePolicy: "allow" }, () => 0);
    assert.equal(first.mode, "form");
    assert.equal(first.lines?.length, 3);
    assert.match(first.lines?.[0] ?? "", /^fill page\.name /);
    assert.match(first.lines?.[1] ?? "", /^fill page\.email /);
    assert.equal(first.lines?.[2], "click page.submit");
    const nameStep = parseLine(first.lines![0]!);
    const emailStep = parseLine(first.lines![1]!);
    assert.ok(nameStep && !("comment" in nameStep) && nameStep.kind === "fill");
    assert.ok(emailStep && !("comment" in emailStep) && emailStep.kind === "fill");
    if (nameStep.kind === "fill") {
      assert.ok(nameStep.value.length > 0);
      assert.notEqual(nameStep.value, "x");
    }
    if (emailStep.kind === "fill") assert.match(emailStep.value, /@example\./);
    assert.equal(first.line, first.lines![0]);
    assert.deepEqual(decisionLines(first), first.lines);
    const mid = viewOf({
      shown: [
        { id: "name", value: "x", type: "text" },
        { id: "email", value: "", type: "email" },
      ],
      actions: [{ id: "submit" }],
    });
    const midD = decideUnleash({ view: mid, stepsUsed: 1, writePolicy: "allow" });
    assert.equal(midD.lines?.length, 2);
    assert.match(midD.lines?.[0] ?? "", /^fill page\.email /);
    assert.equal(midD.lines?.[1], "click page.submit");
    const ready = viewOf({
      shown: [
        { id: "name", value: "x", type: "text" },
        { id: "email", value: "user@example.com", type: "email" },
      ],
      actions: [{ id: "submit" }, { id: "open_create" }],
    });
    assert.equal(decideUnleash({ view: ready, stepsUsed: 2, writePolicy: "allow" }).line, "click page.submit");
  });

  it("treats Create as form submit without blocking map from opening Add", () => {
    assert.equal(formSubmitAction([{ id: "button_add_customer" }]), undefined);
    assert.equal(formSubmitAction([{ id: "add_bank_account", label: "Add bank account" }]), undefined);
    assert.equal(formSubmitAction([{ id: "create", label: "Create pipeline" }])?.id, "create");
    assert.equal(formSubmitAction([{ id: "open_create", opens: "create" }]), undefined);
    assert.equal(
      formSubmitAction([{ id: "button_create", label: "Create", opens: "add_customer" }], "add_customer")
        ?.id,
      "button_create",
    );
    assert.equal(formSubmitAction([{ id: "button_create", opens: "add_customer" }]), undefined);
    assert.equal(formDismissAction([{ id: "button_cancel", opens: "add_customer" }])?.id, "button_cancel");
    assert.equal(isWriteAction({ id: "button_add_customer" }), false);
  });

  it("fills a dialog form instead of clicking close", () => {
    const view = viewOf({
      page: "customers",
      surface: "add_customer",
      stack: ["page", "add_customer"],
      shown: [
        { id: "name", value: "", type: "text" },
        { id: "notes", value: "", type: "text" },
      ],
      actions: [
        { id: "button_close", label: "Close" },
        { id: "cancel", label: "Cancel" },
        { id: "create", label: "Create" },
      ],
    });
    for (let i = 0; i < 20; i++) {
      const d = decideUnleash({ view, stepsUsed: i, writePolicy: "allow" }, () => 0.5);
      assert.equal(d.mode, "form");
      const text = (d.lines ?? [d.line]).join("\n");
      assert.doesNotMatch(text, /button_close|cancel/);
      assert.match(text, /fill add_customer\.(name|notes) /);
      assert.match(text, /click add_customer\.create/);
    }
  });

  it("submits a dialog even when Create/Cancel were stamped with self-opens", () => {
    const view = viewOf({
      page: "customers",
      surface: "add_customer",
      stack: ["page", "add_customer"],
      shown: [
        { id: "name", value: "", type: "text" },
        { id: "notes", value: "", type: "text" },
      ],
      actions: [
        { id: "button_cancel", label: "Cancel", opens: "add_customer" },
        { id: "button_create", label: "Create", opens: "add_customer" },
        { id: "button_close", label: "Close", opens: "add_customer" },
      ],
    });
    const submit = decideUnleash({ view, stepsUsed: 0, writePolicy: "allow" }, () => 0.5);
    assert.equal(submit.mode, "form");
    const submitText = (submit.lines ?? [submit.line]).join("\n");
    assert.match(submitText, /fill add_customer\.name /);
    assert.match(submitText, /click add_customer\.button_create/);
    assert.doesNotMatch(submitText, /button_cancel|button_close/);
    const dismiss = decideUnleash({ view, stepsUsed: 0, writePolicy: "allow" }, () => 0);
    assert.equal(dismiss.mode, "form");
    const dismissText = (dismiss.lines ?? [dismiss.line]).join("\n");
    assert.match(dismissText, /fill add_customer\.name /);
    assert.match(dismissText, /click add_customer\.button_cancel/);
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
