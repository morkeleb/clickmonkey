import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { emptyDraft, PageModel } from "../src/schema/index.js";
import type { PageModel as PageModelType } from "../src/schema/page-model.js";
import {
  identityKey,
  mergePageModel,
  mergeTrees,
  offlineIdsExist,
  type Candidate,
  type MergeInput,
} from "../src/surveyor/merge.js";

function loadHome(): PageModelType {
  const path = fileURLToPath(new URL("../fixtures/models/valid-home.json", import.meta.url));
  return PageModel.parse(JSON.parse(readFileSync(path, "utf8")));
}

function dialogInput(overrides: Partial<MergeInput> = {}): MergeInput {
  return {
    pageId: "home",
    surfaceId: "createDialog",
    surfaceKind: "dialog",
    surfaceLocator: { by: "role", value: "dialog", name: "Create" },
    candidates: [
      { kind: "field", by: "testId", value: "name", type: "text", required: true, resolves: true },
      { kind: "action", by: "testId", value: "submit", resolves: true },
    ],
    leftoverResolves: {},
    ...overrides,
  };
}

function surface(model: PageModelType, id: string) {
  const page = model.pages.find((p) => p.id === "home");
  assert.ok(page);
  const s = page.surfaces.find((x) => x.id === id);
  assert.ok(s);
  return s;
}

describe("mergePageModel", () => {
  it("keeps the same id when by+value match (no submit_2)", () => {
    const first = mergePageModel(loadHome(), dialogInput());
    assert.equal(first.appended.length, 0);
    assert.equal(first.createdSurface, false);
    assert.equal(first.model.generation, 0);

    const actions = surface(first.model, "createDialog").actions;
    assert.equal(actions.filter((a) => a.value === "submit").length, 1);
    assert.equal(actions[0]?.id, "submit");
    assert.ok(!actions.some((a) => a.id === "submit_2"));

    const second = mergePageModel(first.model, dialogInput());
    const again = surface(second.model, "createDialog").actions;
    assert.equal(again.length, 1);
    assert.equal(again[0]?.id, "submit");
    assert.ok(!again.some((a) => a.id === "submit_2"));
    assert.equal(second.model.generation, 0);
  });

  it("appends a new resolving footer action and increments generation", () => {
    const footer: Candidate = {
      kind: "action",
      by: "testId",
      value: "site-footer",
      resolves: true,
    };
    const result = mergePageModel(loadHome(), {
      pageId: "home",
      surfaceId: "page",
      surfaceKind: "page",
      candidates: [footer],
      leftoverResolves: {},
    });
    assert.deepEqual(result.appended, ["site_footer"]);
    assert.equal(result.createdSurface, false);
    assert.equal(result.model.generation, 1);
    const action = surface(result.model, "page").actions.find((a) => a.id === "site_footer");
    assert.ok(action);
    assert.equal(action.by, "testId");
    assert.equal(action.value, "site-footer");
    assert.equal(action.status, "ok");
  });

  it("offlineIdsExist ignores extra widgets for usedLocators keys", () => {
    const withExtra = mergePageModel(loadHome(), {
      pageId: "home",
      surfaceId: "page",
      surfaceKind: "page",
      candidates: [{ kind: "action", by: "testId", value: "site-footer", resolves: true }],
      leftoverResolves: {},
    });
    const check = offlineIdsExist(withExtra.model, ["createDialog.name", "page:home.ready"]);
    assert.equal(check.ok, true);
    assert.deepEqual(check.missing, []);
  });

  it("offlineIdsExist finds widgets on a later page with the same surface id", () => {
    const model = loadHome();
    model.pages.unshift({
      id: "login",
      path: "/login",
      entry: true,
      ready: { by: "testId", value: "login" },
      surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
    });
    const home = model.pages.find((p) => p.id === "home");
    assert.ok(home);
    const page = home.surfaces.find((s) => s.id === "page");
    assert.ok(page);
    page.actions.push({ id: "go", by: "testId", value: "go", status: "ok" });
    const check = offlineIdsExist(model, ["page.go"]);
    assert.equal(check.ok, true, check.missing.join(","));
  });

  it("offlineIdsExist is false when createDialog.name was deleted", () => {
    const model = loadHome();
    const dialog = surface(model, "createDialog");
    dialog.fields = [];
    const check = offlineIdsExist(model, ["createDialog.name"]);
    assert.equal(check.ok, false);
    assert.deepEqual(check.missing, ["createDialog.name"]);
  });

  it("marks leftover label-derived actions as drift and mints a new id for the new name", () => {
    const model = loadHome();
    surface(model, "page").actions.push({
      id: "save",
      by: "role",
      value: "button",
      name: "Save",
      status: "ok",
    });
    const saveKey = identityKey("page", "role", "button", "Save");
    const result = mergePageModel(model, {
      pageId: "home",
      surfaceId: "page",
      surfaceKind: "page",
      candidates: [
        { kind: "action", by: "role", value: "button", name: "Save changes", resolves: true },
      ],
      leftoverResolves: { [saveKey]: false },
    });
    const page = surface(result.model, "page");
    const drifted = page.actions.find((a) => a.id === "save");
    assert.ok(drifted);
    assert.equal(drifted.status, "drift");
    assert.equal(drifted.previousLabel, "Save");
    assert.equal(drifted.name, "Save");
    const minted = page.actions.find((a) => a.id === "button_save_changes");
    assert.ok(minted);
    assert.equal(minted.name, "Save changes");
    assert.equal(minted.status, "ok");
    assert.deepEqual(result.appended, ["button_save_changes"]);
  });

  it("does not insert a new unresolved candidate", () => {
    const result = mergePageModel(
      loadHome(),
      dialogInput({
        candidates: [{ kind: "field", by: "testId", value: "ghost", resolves: false }],
      }),
    );
    const dialog = surface(result.model, "createDialog");
    assert.ok(!dialog.fields.some((f) => f.value === "ghost"));
    assert.equal(result.appended.length, 0);
    assert.equal(result.model.generation, 0);
  });

  it("does not change closed-dialog leftovers when leftoverResolves omits the key", () => {
    const result = mergePageModel(loadHome(), {
      pageId: "home",
      surfaceId: "page",
      surfaceKind: "page",
      candidates: [{ kind: "action", by: "testId", value: "open-create", resolves: true }],
      leftoverResolves: {},
    });
    const dialog = surface(result.model, "createDialog");
    const name = dialog.fields.find((f) => f.id === "name");
    assert.ok(name);
    assert.equal(name.status, "ok");
    assert.equal(name.previousLabel, undefined);

    const omitted = mergePageModel(loadHome(), {
      pageId: "home",
      surfaceId: "createDialog",
      surfaceKind: "dialog",
      candidates: [],
      leftoverResolves: {},
    });
    const still = surface(omitted.model, "createDialog");
    assert.equal(still.fields[0]?.id, "name");
    assert.equal(still.fields[0]?.status, "ok");
    assert.equal(still.actions[0]?.id, "submit");
    assert.equal(still.actions[0]?.status, "ok");
    assert.equal(omitted.model.generation, 0);
  });
});

describe("mergeTrees", () => {
  it("unions pages and widgets from two monkeys without reminting", () => {
    const a = loadHome();
    const b = structuredClone(a);
    b.pages[0]!.surfaces[0]!.actions.push({
      id: "site_footer",
      by: "testId",
      value: "site-footer",
      status: "ok",
    });
    const extraPage = structuredClone(a.pages[0]!);
    extraPage.id = "login";
    extraPage.path = "/login";
    extraPage.ready = { by: "testId", value: "login" };
    extraPage.surfaces = [{ id: "page", kind: "page", fields: [], actions: [] }];
    b.pages.push(extraPage);

    const merged = mergeTrees(a, b);
    assert.equal(merged.pages.length, 2);
    assert.ok(merged.pages.some((p) => p.id === "login"));
    const page = merged.pages.find((p) => p.id === "home");
    assert.ok(page);
    assert.ok(page.surfaces[0]?.actions.some((x) => x.id === "site_footer"));
    assert.ok(page.surfaces[0]?.actions.some((x) => x.id === "openCreate"));
    const submit = page.surfaces.find((s) => s.id === "createDialog")?.actions.filter((x) => x.value === "submit");
    assert.equal(submit?.length, 1);
  });

  it("keeps same-path pages on different origins apart and stamps origin onto a legacy page", () => {
    const base = loadHome();
    const idp = structuredClone(base.pages[0]!);
    idp.id = "u_login";
    idp.path = "/u/login";
    idp.origin = "https://idp.example.com";
    idp.ready = { by: "name", value: "username" };
    idp.surfaces = [{ id: "page", kind: "page", fields: [], actions: [] }];
    const incoming = structuredClone(base);
    incoming.pages = [idp];
    const merged = mergeTrees(base, incoming);
    assert.equal(merged.pages.length, 2);
    assert.ok(merged.pages.some((p) => p.id === "home" && !p.origin));
    assert.ok(merged.pages.some((p) => p.id === "u_login" && p.origin === "https://idp.example.com"));

    const legacy = structuredClone(idp);
    delete legacy.origin;
    const stamped = mergeTrees({ ...emptyDraft("x"), pages: [legacy] }, incoming);
    assert.equal(stamped.pages.length, 1);
    assert.equal(stamped.pages[0]?.origin, "https://idp.example.com");
  });

  it("does not merge an origin-less incoming page into a foreign-origin twin", () => {
    const idp = structuredClone(loadHome().pages[0]!);
    idp.id = "login";
    idp.path = "/login";
    idp.origin = "https://idp.example.com";
    idp.surfaces = [{ id: "page", kind: "page", fields: [], actions: [] }];
    const app = structuredClone(idp);
    delete app.origin;
    app.id = "login";
    app.surfaces = [
      {
        id: "page",
        kind: "page",
        fields: [],
        actions: [{ id: "app_go", by: "testId", value: "app-go", status: "ok" }],
      },
    ];
    const merged = mergeTrees({ ...emptyDraft("x"), pages: [idp] }, { ...emptyDraft("x"), pages: [app] });
    assert.equal(merged.pages.length, 2);
    const foreign = merged.pages.find((p) => p.origin === "https://idp.example.com");
    const leash = merged.pages.find((p) => p.path === "/login" && !p.origin);
    assert.ok(foreign);
    assert.ok(leash);
    assert.equal(foreign.surfaces[0]?.actions.some((a) => a.id === "app_go"), false);
    assert.ok(leash.surfaces[0]?.actions.some((a) => a.id === "app_go"));
  });
});
