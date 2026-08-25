import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UiGraphNode, UiSnapshot } from "@schema/ui";
import { applyLastFog } from "./api.ts";

function node(id: string, fogAt?: string, jobFog?: UiGraphNode["jobFog"]): UiGraphNode {
  return {
    id,
    kind: "page",
    pageId: id,
    label: id,
    path: `/${id}`,
    red: 0,
    yellow: 0,
    ...(fogAt ? { fogAt } : {}),
    ...(jobFog ? { jobFog } : {}),
  };
}

function snap(nodes: UiGraphNode[]): UiSnapshot {
  return { graph: { nodes, edges: [] } } as UiSnapshot;
}

describe("applyLastFog", () => {
  it("stamps fogAt onto matching page nodes and leaves others alone", () => {
    const prev = snap([node("home", "2026-01-01T00:00:00.000Z"), node("invoices")]);
    const next = applyLastFog(prev, {
      home: { at: "2026-01-01T00:00:00.000Z", map: "2026-01-01T00:00:00.000Z" },
      invoices: { at: "2026-06-01T00:00:00.000Z", unleash: "2026-06-01T00:00:00.000Z" },
    });
    assert.equal(next.graph.nodes.find((n) => n.id === "home")?.fogAt, "2026-01-01T00:00:00.000Z");
    assert.equal(next.graph.nodes.find((n) => n.id === "home")?.jobFog?.map, "2026-01-01T00:00:00.000Z");
    assert.equal(next.graph.nodes.find((n) => n.id === "invoices")?.fogAt, "2026-06-01T00:00:00.000Z");
    assert.equal(next.graph.nodes.find((n) => n.id === "invoices")?.jobFog?.unleash, "2026-06-01T00:00:00.000Z");
    const cleared = applyLastFog(next, { invoices: { at: "2026-06-01T00:00:00.000Z" } });
    assert.equal(cleared.graph.nodes.find((n) => n.id === "home")?.fogAt, undefined);
    assert.equal(cleared.graph.nodes.find((n) => n.id === "home")?.jobFog, undefined);
    assert.equal(cleared.graph.nodes.find((n) => n.id === "invoices")?.fogAt, "2026-06-01T00:00:00.000Z");
    assert.equal(cleared.graph.nodes.find((n) => n.id === "invoices")?.jobFog, undefined);
  });
});
