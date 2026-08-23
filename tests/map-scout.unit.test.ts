import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideMapScout, fogClicks } from "../src/brains/map-scout.js";
import { decideMap } from "../src/brains/unleash.js";
import type { Page } from "../src/schema/page-model.js";
import type { View } from "../src/schema/view.js";

function pageOf(opts: {
  id: string;
  path?: string;
  surfaces: Array<{
    id: string;
    kind: "page" | "dialog";
    actions?: Array<{ id: string; opens?: string }>;
  }>;
}): Page {
  return {
    id: opts.id,
    path: opts.path ?? `/${opts.id}`,
    params: [],
    ready: { by: "testId", value: opts.id },
    surfaces: opts.surfaces.map((s) => ({
      id: s.id,
      kind: s.kind,
      fields: [],
      actions: (s.actions ?? []).map((a) => ({
        id: a.id,
        by: "testId" as const,
        value: a.id,
        status: "ok" as const,
        ...(a.opens ? { opens: a.opens } : {}),
      })),
    })),
  };
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

const home = pageOf({
  id: "home",
  path: "/",
  surfaces: [
    {
      id: "page",
      kind: "page",
      actions: [
        { id: "link_about", opens: "about" },
        { id: "open_create", opens: "create" },
      ],
    },
    { id: "create", kind: "dialog", actions: [] },
  ],
});

const about = pageOf({
  id: "about",
  surfaces: [{ id: "page", kind: "page", actions: [{ id: "link_home", opens: "home" }] }],
});

describe("fogClicks", () => {
  it("treats an unopened dialog and an unvisited page hop as fog", () => {
    const view = viewOf({
      pages: ["home", "about"],
      actions: [
        { id: "collections", nav: true },
        { id: "open_create", opens: "create" },
        { id: "link_about", opens: "about" },
      ],
    });
    const ids = fogClicks({
      view,
      stepsUsed: 1,
      pages: [home, about],
      pageVisits: { "home/page": 1 },
    }).map((a) => a.id);
    assert.ok(ids.includes("open_create"));
    assert.ok(ids.includes("link_about"));
    assert.ok(ids.includes("collections"));
  });

  it("drops a hop whose destination was already visited", () => {
    const view = viewOf({
      pages: ["home", "about"],
      actions: [
        { id: "link_about", opens: "about" },
        { id: "open_create", opens: "create" },
      ],
    });
    const ids = fogClicks({
      view,
      stepsUsed: 3,
      pages: [home, about],
      pageVisits: { "home/page": 1, "about/page": 1 },
    }).map((a) => a.id);
    assert.deepEqual(ids, ["open_create"]);
  });
});

describe("decideMapScout", () => {
  it("clicks an unseen dialog opener before sidebar chrome", () => {
    const view = viewOf({
      pages: ["home", "about"],
      actions: [
        { id: "collections", nav: true },
        { id: "open_create", opens: "create" },
      ],
    });
    const d = decideMap(
      {
        view,
        stepsUsed: 1,
        pages: [home, about],
        pageVisits: { "home/page": 1 },
      },
      () => 0.1,
    );
    assert.equal(d.line, "click page.open_create");
    assert.equal(d.note, "map scout");
  });

  it("keeps a committed scout target across steps", () => {
    const extra = pageOf({
      id: "extra",
      surfaces: [{ id: "page", kind: "page", actions: [] }],
    });
    const d = decideMapScout(
      {
        view: viewOf({
          page: "home",
          pages: ["home", "about", "extra"],
          actions: [{ id: "submit" }],
        }),
        stepsUsed: 2,
        pages: [home, about, extra],
        pageVisits: { "home/page": 2 },
        huntTarget: "about/page",
      },
      () => 0.5,
    );
    assert.equal(d?.line, "open about");
    assert.equal(d?.huntTarget, "about/page");
  });

  it("opens an unvisited hoppable page when nothing local is fog", () => {
    const view = viewOf({
      page: "home",
      pages: ["home", "about"],
      actions: [{ id: "submit" }],
    });
    const d = decideMap({
      view,
      stepsUsed: 2,
      pages: [home, about],
      pageVisits: { "home/page": 2 },
    });
    assert.equal(d.line, "open about");
    assert.equal(d.note, "map scout");
  });
});
