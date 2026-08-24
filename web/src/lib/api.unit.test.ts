import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UiGraphNode, UiSnapshot } from "@schema/ui";
import { applyLastLands } from "./api.ts";

function node(id: string, lastLandAt?: string, jobLands?: UiGraphNode["jobLands"]): UiGraphNode {
  return {
    id,
    kind: "page",
    pageId: id,
    label: id,
    path: `/${id}`,
    red: 0,
    yellow: 0,
    ...(lastLandAt ? { lastLandAt } : {}),
    ...(jobLands ? { jobLands } : {}),
  };
}

function snap(nodes: UiGraphNode[]): UiSnapshot {
  return { graph: { nodes, edges: [] } } as UiSnapshot;
}

describe("applyLastLands", () => {
  it("stamps lastLandAt onto matching page nodes and leaves others alone", () => {
    const prev = snap([node("home", "2026-01-01T00:00:00.000Z"), node("invoices")]);
    const next = applyLastLands(prev, {
      home: { at: "2026-01-01T00:00:00.000Z", map: "2026-01-01T00:00:00.000Z" },
      invoices: { at: "2026-06-01T00:00:00.000Z", unleash: "2026-06-01T00:00:00.000Z" },
    });
    assert.equal(next.graph.nodes.find((n) => n.id === "home")?.lastLandAt, "2026-01-01T00:00:00.000Z");
    assert.equal(next.graph.nodes.find((n) => n.id === "home")?.jobLands?.map, "2026-01-01T00:00:00.000Z");
    assert.equal(next.graph.nodes.find((n) => n.id === "invoices")?.lastLandAt, "2026-06-01T00:00:00.000Z");
    assert.equal(next.graph.nodes.find((n) => n.id === "invoices")?.jobLands?.unleash, "2026-06-01T00:00:00.000Z");
    const cleared = applyLastLands(next, { invoices: { at: "2026-06-01T00:00:00.000Z" } });
    assert.equal(cleared.graph.nodes.find((n) => n.id === "home")?.lastLandAt, undefined);
    assert.equal(cleared.graph.nodes.find((n) => n.id === "home")?.jobLands, undefined);
    assert.equal(cleared.graph.nodes.find((n) => n.id === "invoices")?.lastLandAt, "2026-06-01T00:00:00.000Z");
    assert.equal(cleared.graph.nodes.find((n) => n.id === "invoices")?.jobLands, undefined);
  });
});
