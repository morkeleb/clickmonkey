import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UiGraphNode, UiSnapshot } from "@schema/ui";
import { applyLastLands } from "./api.ts";

function node(id: string, lastLandAt?: string): UiGraphNode {
  return {
    id,
    kind: "page",
    pageId: id,
    label: id,
    path: `/${id}`,
    red: 0,
    yellow: 0,
    ...(lastLandAt ? { lastLandAt } : {}),
  };
}

function snap(nodes: UiGraphNode[]): UiSnapshot {
  return { graph: { nodes, edges: [] } } as UiSnapshot;
}

describe("applyLastLands", () => {
  it("stamps lastLandAt onto matching page nodes and leaves others alone", () => {
    const prev = snap([node("home", "2026-01-01T00:00:00.000Z"), node("invoices")]);
    const next = applyLastLands(prev, {
      home: "2026-01-01T00:00:00.000Z",
      invoices: "2026-06-01T00:00:00.000Z",
    });
    assert.equal(next.graph.nodes.find((n) => n.id === "home")?.lastLandAt, "2026-01-01T00:00:00.000Z");
    assert.equal(next.graph.nodes.find((n) => n.id === "invoices")?.lastLandAt, "2026-06-01T00:00:00.000Z");
    const cleared = applyLastLands(next, { invoices: "2026-06-01T00:00:00.000Z" });
    assert.equal(cleared.graph.nodes.find((n) => n.id === "home")?.lastLandAt, undefined);
    assert.equal(cleared.graph.nodes.find((n) => n.id === "invoices")?.lastLandAt, "2026-06-01T00:00:00.000Z");
  });
});
