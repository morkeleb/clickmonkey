import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UiGraph } from "@schema/ui";
import type { UiRun } from "@schema/ui";
import { absoluteBoxes, adoptFlowNodes, defaultExpanded, layoutGraph, mergeExpanded, sameFlowNodes } from "./layout.ts";
import { RANK_SEP, boxesOverlap } from "./layout-metrics.ts";

function page(id: string, path: string, opts?: { entry?: boolean; dialogs?: string[] }) {
  const nodes: UiGraph["nodes"] = [
    {
      id,
      kind: "page",
      pageId: id,
      label: id,
      path,
      red: 0,
      yellow: 0,
      ...(opts?.entry ? { entry: true } : {}),
    },
  ];
  const edges: UiGraph["edges"] = [];
  for (const dialog of opts?.dialogs ?? []) {
    const dialogId = `${id}::${dialog}`;
    nodes.push({
      id: dialogId,
      kind: "dialog",
      pageId: id,
      label: dialog,
      path,
      red: 0,
      yellow: 0,
    });
    edges.push({ id: `${id}->${dialogId}`, source: id, target: dialogId });
  }
  return { nodes, edges };
}

function graph(parts: Array<ReturnType<typeof page>>, hops: Array<{ from: string; to: string }>): UiGraph {
  return {
    nodes: parts.flatMap((p) => p.nodes),
    edges: [
      ...parts.flatMap((p) => p.edges),
      ...hops.map((h) => ({ id: `${h.from}->${h.to}`, source: h.from, target: h.to })),
    ],
  };
}

function unrelated(a: { id: string }, b: { id: string }, parentOf: Map<string, string | undefined>): boolean {
  let p: string | undefined = a.id;
  while (p) {
    if (p === b.id) return false;
    p = parentOf.get(p);
  }
  p = b.id;
  while (p) {
    if (p === a.id) return false;
    p = parentOf.get(p);
  }
  return true;
}

describe("layoutGraph dialog rail", () => {
  it("keeps a tall Home dialog stack off the next-rank page card", () => {
    const tabs = Array.from({ length: 15 }, (_, i) => `extra_panel_${i + 1}`);
    const g = graph(
      [
        page("home", "/", { entry: true, dialogs: tabs }),
        page("fees", "/fees-and-cost"),
        page("calendar", "/calendar", { dialogs: ["extra_panel_1", "extra_panel_2"] }),
      ],
      [
        { from: "home", to: "fees" },
        { from: "home", to: "calendar" },
      ],
    );
    const laid = layoutGraph(g, [], { selectedId: "home" });
    const parentOf = new Map(laid.nodes.map((n) => [n.id, n.parentId]));
    const boxes = absoluteBoxes(laid.nodes);
    const home = boxes.find((b) => b.id === "home");
    const fees = boxes.find((b) => b.id === "fees");
    const firstDialog = boxes.find((b) => b.id === "home::extra_panel_1");
    const lastDialog = boxes.find((b) => b.id === "home::extra_panel_15");
    if (!home || !fees || !firstDialog || !lastDialog) {
      assert.fail("expected home, fees, and the first/last Home dialogs");
    }
    assert.equal(home.width, 188, "selecting a page must not grow the dagre box");
    assert.equal(home.height, 72);
    assert.ok(firstDialog.x >= home.x + 188, "dialogs sit in the rail, not on the card");
    const idle = layoutGraph(g, []);
    const idleHome = idle.nodes.find((n) => n.id === "home");
    const selectedHome = laid.nodes.find((n) => n.id === "home");
    assert.deepEqual(idleHome?.position, selectedHome?.position, "opening the drawer must not move the map");
    assert.ok(fees.x >= home.x + home.width + RANK_SEP - 1, "next rank starts after the home box");
    assert.equal(boxesOverlap(home, fees), false);

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (a.id.includes("::") || b.id.includes("::")) continue;
        if (!unrelated(a, b, parentOf)) continue;
        assert.equal(boxesOverlap(a, b), false, `${a.id} overlaps ${b.id}`);
      }
    }
  });

  it("hides dialog rails until a page is selected", () => {
    const g = graph(
      [page("home", "/", { entry: true, dialogs: ["create"] }), page("fees", "/fees-and-cost")],
      [{ from: "home", to: "fees" }],
    );
    const idle = layoutGraph(g, []);
    assert.equal(idle.nodes.some((n) => n.id === "home::create"), false);
    const open = layoutGraph(g, [], { selectedId: "home" });
    assert.equal(open.nodes.some((n) => n.id === "home::create"), true);
  });

  it("does not draw Active tabs overflow chips on the map", () => {
    const g = graph(
      [page("home", "/", { entry: true, dialogs: ["active_tabs", "active_tabs_3", "create"] })],
      [],
    );
    const laid = layoutGraph(g, [], { selectedId: "home" });
    assert.equal(laid.nodes.some((n) => n.id === "home::create"), true);
    assert.equal(laid.nodes.some((n) => /active_tabs/.test(n.id)), false);
  });

  it("routes cross-section arrows to the section box, not every nested page", () => {
    const g = graph(
      [
        page("home", "/", { entry: true }),
        page("vouchers", "/accounts-payable/vouchers"),
        page("vouchers_new", "/accounts-payable/vouchers/new"),
        page("vendors", "/accounts-payable/vendors"),
        page("payments", "/accounts-payable/payments"),
      ],
      [
        { from: "home", to: "vouchers" },
        { from: "home", to: "vouchers_new" },
        { from: "home", to: "vendors" },
        { from: "home", to: "payments" },
        { from: "vouchers", to: "vouchers_new" },
      ],
    );
    const laid = layoutGraph(g, [], { expanded: new Set(["accounts-payable"]) });
    const fromHome = laid.edges.filter((e) => e.source === "home");
    assert.equal(fromHome.length, 1);
    assert.equal(fromHome[0]?.target, "section:accounts-payable");
    assert.ok(laid.edges.some((e) => e.source === "vouchers" && e.target === "vouchers_new"));
  });

  it("packs a large expanded section into two columns", () => {
    const pages = Array.from({ length: 10 }, (_, i) => page(`p${i}`, `/accounts-payable/p${i}`));
    const g = graph(pages, []);
    const laid = layoutGraph(g, [], { expanded: new Set(["accounts-payable"]) });
    const kids = laid.nodes.filter((n) => n.parentId === "section:accounts-payable");
    assert.equal(kids.length, 10);
    const xs = [...new Set(kids.map((n) => Math.round(n.position.x)))].sort((a, b) => a - b);
    assert.equal(xs.length, 2);
    const section = laid.nodes.find((n) => n.id === "section:accounts-payable");
    const oneCol = 58 * 10 + 6 * 9 + 56 + 12;
    assert.ok(
      Number(section?.style?.height ?? 0) < oneCol,
      `expected a packed section, got height ${section?.style?.height}`,
    );
  });

  it("mergeExpanded keeps the same Set when sections did not change", () => {
    const g = graph(
      [page("a", "/accounts-payable/a"), page("b", "/accounts-payable/b")],
      [],
    );
    const first = defaultExpanded(g);
    const again = mergeExpanded(first, g);
    assert.equal(again, first);
    const grown = mergeExpanded(first, g);
    assert.equal(grown, first);
  });

  it("mergeExpanded does not re-open a collapsed section", () => {
    const g = graph(
      [page("a", "/accounts-payable/a"), page("b", "/accounts-payable/b")],
      [],
    );
    const collapsed = mergeExpanded(new Set(), g, defaultExpanded(g));
    assert.equal(collapsed.size, 0);
    const still = mergeExpanded(collapsed, g, defaultExpanded(g));
    assert.equal(still, collapsed);
  });

  it("mergeExpanded opens a cluster that was not on the previous map", () => {
    const before = graph(
      [page("a", "/accounts-payable/a"), page("b", "/accounts-payable/b")],
      [],
    );
    const after = graph(
      [
        page("a", "/accounts-payable/a"),
        page("b", "/accounts-payable/b"),
        page("c", "/invoices/c"),
        page("d", "/invoices/d"),
      ],
      [],
    );
    const prev = new Set<string>();
    const next = mergeExpanded(prev, after, defaultExpanded(before));
    assert.equal(next.has("accounts-payable"), false);
    assert.equal(next.has("invoices"), true);
  });

  it("sameFlowNodes is true for cloned layout with the same cards", () => {
    const g = graph([page("home", "/", { entry: true })], []);
    const a = layoutGraph(g, []);
    const b = layoutGraph(g, []);
    assert.equal(sameFlowNodes(a.nodes, b.nodes), true);
    const moved = [{ ...a.nodes[0]!, position: { x: 1, y: 1 } }];
    assert.equal(sameFlowNodes(a.nodes, moved), false);
  });

  it("layoutGraph positions do not depend on node insertion order", () => {
    const hops = [
      { from: "home", to: "fees" },
      { from: "home", to: "calendar" },
    ] as const;
    const forward = graph(
      [
        page("home", "/", { entry: true }),
        page("fees", "/fees-and-cost"),
        page("calendar", "/calendar"),
      ],
      [...hops],
    );
    const reverse = graph(
      [
        page("calendar", "/calendar"),
        page("fees", "/fees-and-cost"),
        page("home", "/", { entry: true }),
      ],
      [...hops].reverse(),
    );
    const a = layoutGraph(forward, []);
    const b = layoutGraph(reverse, []);
    const pos = (nodes: typeof a.nodes) =>
      Object.fromEntries(nodes.filter((n) => n.data.kind === "page").map((n) => [n.id, n.position]));
    assert.deepEqual(pos(a.nodes), pos(b.nodes));
  });

  it("adoptFlowNodes keeps card positions when only live rings change", () => {
    const g = graph([page("home", "/", { entry: true })], []);
    const idle = layoutGraph(g, []);
    const liveRun: UiRun = {
      id: "r1",
      name: "amber-asp",
      hue: 12,
      live: true,
      pageId: "home",
      findingCount: 0,
    };
    const live = layoutGraph(g, [liveRun]);
    assert.equal(sameFlowNodes(idle.nodes, live.nodes), false);
    const adopted = adoptFlowNodes(idle.nodes, live.nodes);
    assert.equal(adopted.length, idle.nodes.length);
    assert.deepEqual(adopted[0]!.position, idle.nodes[0]!.position);
    assert.equal(adopted[0]!.data.rings.length, 1);
    assert.equal(adopted[0]!.data.rings[0]?.name, "amber-asp");
    const again = adoptFlowNodes(adopted, live.nodes);
    assert.equal(again, adopted);
  });
});
