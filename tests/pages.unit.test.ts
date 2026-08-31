import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseDropIds } from "../src/cli/cmd-pages.js";
import { dropPageChoices } from "../src/cli/prompt-pages.js";
import { saveConfig } from "../src/persist/config.js";
import { dropMapPages, formatPagesStatus, pageGcRows } from "../src/persist/pages.js";
import { emptyBrokenReport, type BrokenReport } from "../src/schema/broken.js";
import { emptyConfig } from "../src/schema/config.js";
import type { Action, Page } from "../src/schema/page-model.js";

function action(id: string, extra?: Partial<Action>): Action {
  return {
    id,
    by: "testId",
    value: id,
    status: "ok",
    ...extra,
  };
}

function page(id: string, path: string, extra?: Partial<Page>): Page {
  const { surfaces, params, ...rest } = extra ?? {};
  return {
    id,
    path,
    params: params ?? [],
    ready: { by: "testId", value: id },
    surfaces: surfaces ?? [{ id: "page", kind: "page", fields: [], actions: [] }],
    ...rest,
  };
}

function mapOf(...pages: Page[]) {
  return { schemaVersion: 1 as const, app: "app", generation: 0, pages };
}

function broken404(path: string, resourceType?: "document" | "xhr"): BrokenReport {
  return {
    schemaVersion: 1,
    entries: [
      {
        path,
        url: `http://127.0.0.1:4173${path}`,
        status: 404,
        foundAt: "2026-01-01T00:00:00.000Z",
        ...(resourceType ? { resourceType } : {}),
      },
    ],
  };
}

describe("parseDropIds", () => {
  it("splits commas and whitespace and drops empties", () => {
    assert.deepEqual(parseDropIds("a, b  c,"), ["a", "b", "c"]);
    assert.deepEqual(parseDropIds("  "), []);
  });
});

describe("pageGcRows", () => {
  it("recommends a 404 room with no live inbound", () => {
    const gone = page("gone", "/gone");
    const home = page("home", "/");
    const rows = pageGcRows(mapOf(home, gone), broken404("/gone", "document"));
    const rec = rows.find((r) => r.id === "gone");
    assert.equal(rec?.recommend, true);
    assert.match(rec?.why ?? "", /404 \/gone; no inbound/);
    assert.equal(rows.find((r) => r.id === "home")?.recommend, false);
  });

  it("does not recommend when a live door still opens the room", () => {
    const gone = page("gone", "/gone");
    const home = page("home", "/", {
      surfaces: [{ id: "page", kind: "page", fields: [], actions: [action("openGone", { opens: "gone" })] }],
    });
    const rec = pageGcRows(mapOf(home, gone), broken404("/gone", "document")).find((r) => r.id === "gone");
    assert.equal(rec?.recommend, false);
    assert.equal(rec?.inboundLive, 1);
    assert.equal(rec?.notFound, true);
  });

  it("recommends when inbound doors are only unresolved or drift", () => {
    const gone = page("gone", "/gone");
    const home = page("home", "/", {
      surfaces: [
        {
          id: "page",
          kind: "page",
          fields: [],
          actions: [
            action("old", { opens: "gone", status: "unresolved" }),
            action("stale", { opens: "gone", status: "drift" }),
          ],
        },
      ],
    });
    const rec = pageGcRows(mapOf(home, gone), broken404("/gone")).find((r) => r.id === "gone");
    assert.equal(rec?.recommend, true);
    assert.match(rec?.why ?? "", /2 inbound unresolved/);
  });

  it("does not recommend entry, other-origin, or parametric pages", () => {
    const broken = broken404("/login");
    const entry = page("login", "/login", { entry: true });
    assert.equal(pageGcRows(mapOf(entry), broken).find((r) => r.id === "login")?.recommend, false);

    const sso = page("idp", "/u/login", { origin: "https://idp.example" });
    const ssoBroken: BrokenReport = {
      schemaVersion: 1,
      entries: [
        {
          path: "/u/login",
          url: "https://idp.example/u/login",
          status: 404,
          foundAt: "t",
          resourceType: "document",
        },
      ],
    };
    assert.equal(pageGcRows(mapOf(sso), ssoBroken).find((r) => r.id === "idp")?.recommend, false);

    const templated = page("cust", "/customers/:id1", { params: ["id1"] });
    const inst = broken404("/customers/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    assert.equal(pageGcRows(mapOf(templated), inst).find((r) => r.id === "cust")?.recommend, false);
  });

  it("ignores xhr 404s and hunger without a document 404", () => {
    const gone = page("gone", "/gone", {
      fog: { at: "2020-01-01T00:00:00.000Z", jobs: {}, modes: {} },
    });
    assert.equal(pageGcRows(mapOf(gone), broken404("/gone", "xhr")).find((r) => r.id === "gone")?.recommend, false);
    assert.equal(pageGcRows(mapOf(gone), emptyBrokenReport()).find((r) => r.id === "gone")?.recommend, false);
  });
});

describe("formatPagesStatus", () => {
  it("lists rooms and a recommend-drop block", () => {
    const gone = page("gone", "/gone");
    const home = page("home", "/");
    const text = formatPagesStatus(mapOf(home, gone), broken404("/gone", "document"));
    assert.match(text, /2 pages/);
    assert.match(text, /gone  \/gone/);
    assert.match(text, /404/);
    assert.match(text, /Recommend drop:/);
    assert.match(text, /gone  404 \/gone; no inbound/);
    assert.doesNotMatch(text, /--drop/);
  });
});

describe("dropPageChoices", () => {
  it("pre-checks recommended rooms and describes why", () => {
    const gone = page("gone", "/gone");
    const home = page("home", "/");
    const choices = dropPageChoices(pageGcRows(mapOf(home, gone), broken404("/gone", "document")));
    const goneChoice = choices.find((c) => c.value === "gone");
    const homeChoice = choices.find((c) => c.value === "home");
    assert.equal(goneChoice?.checked, true);
    assert.match(goneChoice?.description ?? "", /404 \/gone/);
    assert.equal(homeChoice?.checked, false);
  });
});

describe("dropMapPages", () => {
  it("removes the page and strips opens hints", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-pages-"));
    const cfg = join(dir, "clickmonkey.json");
    const home = page("home", "/", {
      surfaces: [{ id: "page", kind: "page", fields: [], actions: [action("openGone", { opens: "gone" })] }],
    });
    const gone = page("gone", "/gone");
    saveConfig(cfg, { ...emptyConfig("http://127.0.0.1:4173/"), map: mapOf(home, gone) });
    const { dropped, map } = dropMapPages(cfg, ["gone"]);
    assert.deepEqual(dropped, ["gone"]);
    assert.deepEqual(map.pages.map((p) => p.id), ["home"]);
    assert.equal(map.pages[0]?.surfaces[0]?.actions[0]?.opens, undefined);
  });

  it("rejects unknown ids", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-pages-miss-"));
    const cfg = join(dir, "clickmonkey.json");
    saveConfig(cfg, { ...emptyConfig("http://127.0.0.1:4173/"), map: mapOf(page("home", "/")) });
    assert.throws(() => dropMapPages(cfg, ["nope"]), /unknown page id: nope/);
  });
});
