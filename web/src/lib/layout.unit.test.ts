import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UiGraph } from "@schema/ui";
import { absoluteBoxes, layoutGraph } from "./layout.ts";
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
    const tabs = Array.from({ length: 15 }, (_, i) => `active_tabs_${i + 1}`);
    const g = graph(
      [
        page("home", "/", { entry: true, dialogs: tabs }),
        page("fees", "/fees-and-cost"),
        page("calendar", "/calendar", { dialogs: ["active_tabs_1", "active_tabs_2"] }),
      ],
      [
        { from: "home", to: "fees" },
        { from: "home", to: "calendar" },
      ],
    );
    const laid = layoutGraph(g, []);
    const parentOf = new Map(laid.nodes.map((n) => [n.id, n.parentId]));
    const boxes = absoluteBoxes(laid.nodes);
    const home = boxes.find((b) => b.id === "home");
    const fees = boxes.find((b) => b.id === "fees");
    const firstDialog = boxes.find((b) => b.id === "home::active_tabs_1");
    const lastDialog = boxes.find((b) => b.id === "home::active_tabs_15");
    if (!home || !fees || !firstDialog || !lastDialog) {
      assert.fail("expected home, fees, and the first/last Home dialogs");
    }
    assert.ok(home.width > 188, "home box includes the dialog rail");
    assert.ok(home.height > 72, "home box includes the dialog stack");
    assert.ok(firstDialog.x >= home.x + 188, "dialogs sit in the rail, not on the card");
    assert.ok(lastDialog.x + lastDialog.width <= home.x + home.width + 0.5);
    assert.ok(lastDialog.y + lastDialog.height <= home.y + home.height + 0.5);
    assert.ok(fees.x >= home.x + home.width + RANK_SEP - 1, "next rank starts after the home box");
    assert.equal(boxesOverlap(home, fees), false);

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (!unrelated(a, b, parentOf)) continue;
        assert.equal(boxesOverlap(a, b), false, `${a.id} overlaps ${b.id}`);
      }
    }
  });
});
