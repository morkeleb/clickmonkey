import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { foldActiveTabChrome, mintDialog, pickActiveTabsSurface } from "../src/surveyor/surfaces.js";
import type { Page as ModelPage } from "../src/schema/page-model.js";

describe("mintDialog", () => {
  it("keeps one Active tabs surface across counts", () => {
    const used = new Set(["page", "home"]);
    const first = mintDialog({ accName: "Active tabs: 1", testId: "" }, used);
    assert.equal(first.surfaceId, "active_tabs");
    assert.deepEqual(first.locator, {
      by: "role",
      value: "dialog",
      name: "Active tabs",
      nameExact: false,
    });

    const again = mintDialog({ accName: "Active tabs: 27", testId: "" }, used);
    assert.equal(again.surfaceId, "active_tabs");
    assert.equal(again.locator.nameExact, false);
  });

  it("does not uniqueMint to active_tabs_2 when the id is already used", () => {
    const used = new Set(["page", "active_tabs"]);
    const minted = mintDialog({ accName: "Active tabs: 9", testId: "" }, used);
    assert.equal(minted.surfaceId, "active_tabs");
  });
});

describe("pickActiveTabsSurface", () => {
  it("claims count-suffixed or name-prefixed Active tabs surfaces", () => {
    const surfaces = [
      { id: "create", locator: { by: "role" as const, value: "dialog", name: "Create" } },
      {
        id: "active_tabs__17",
        locator: { by: "role" as const, value: "dialog", name: "Active tabs: 17" },
      },
    ];
    const claimed = new Set<string>();
    const hit = pickActiveTabsSurface(surfaces, claimed);
    assert.equal(hit?.id, "active_tabs__17");
  });

  it("prefers the canonical id", () => {
    const surfaces = [
      { id: "active_tabs__1", locator: { by: "role" as const, value: "dialog", name: "Active tabs: 1" } },
      { id: "active_tabs", locator: { by: "role" as const, value: "dialog", name: "Active tabs" } },
    ];
    const hit = pickActiveTabsSurface(surfaces, new Set());
    assert.equal(hit?.id, "active_tabs");
  });
});

describe("foldActiveTabChrome", () => {
  it("collapses count-suffixed dialogs and openers onto active_tabs", () => {
    const page = {
      id: "home",
      path: "/",
      surfaces: [
        {
          id: "page",
          kind: "page" as const,
          fields: [],
          actions: [
            { id: "button_active_tabs__16", by: "role" as const, value: "button", name: "Active tabs: 16", opens: "active_tabs__16", status: "ok" as const },
            { id: "button_active_tabs__17", by: "role" as const, value: "button", name: "Active tabs: 17", opens: "active_tabs__17", status: "ok" as const },
          ],
        },
        {
          id: "active_tabs__16",
          kind: "dialog" as const,
          locator: { by: "role" as const, value: "dialog", name: "Active tabs: 16" },
          fields: [],
          actions: [],
        },
        {
          id: "active_tabs__17",
          kind: "dialog" as const,
          locator: { by: "role" as const, value: "dialog", name: "Active tabs: 17" },
          fields: [],
          actions: [],
        },
      ],
    } as unknown as ModelPage;
    assert.equal(foldActiveTabChrome(page), true);
    const dialogs = page.surfaces.filter((s) => s.kind === "dialog");
    assert.equal(dialogs.length, 1);
    assert.equal(dialogs[0]?.id, "active_tabs");
    const pageSurf = page.surfaces.find((s) => s.id === "page");
    assert.equal(pageSurf?.actions.length, 1);
    assert.equal(pageSurf?.actions[0]?.id, "button_active_tabs");
    assert.equal(pageSurf?.actions[0]?.opens, "active_tabs");
    assert.equal(pageSurf?.actions[0]?.nameExact, false);
  });
});
