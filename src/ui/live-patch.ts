import type { UiSnapshot } from "../schema/ui.js";

/** Presence, last page, and fog stamps — skip a redraw when nobody moved. */
export function livePatchKey(snapshot: Pick<UiSnapshot, "runs" | "graph">): string {
  const runs = snapshot.runs
    .map((r) =>
      [
        r.id,
        r.live ? "1" : "0",
        r.pageId ?? "",
        String(r.findingCount),
        r.brain ?? "",
        r.outline?.now ?? "",
        r.outline?.charter ?? "",
      ].join("\t"),
    )
    .join("\n");
  const fog = snapshot.graph.nodes
    .map((n) => {
      const j = n.jobFog;
      return [n.pageId, n.fogAt ?? "", j?.map ?? "", j?.unleash ?? "", j?.nasty ?? "", j?.spec ?? ""].join("\t");
    })
    .join("\n");
  return `${runs}\n--\n${fog}`;
}

export function livePatchEqual(
  a: Pick<UiSnapshot, "runs" | "graph">,
  b: Pick<UiSnapshot, "runs" | "graph">,
): boolean {
  return livePatchKey(a) === livePatchKey(b);
}
