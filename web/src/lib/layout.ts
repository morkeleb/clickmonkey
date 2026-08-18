import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import type { UiGraph, UiGraphNode, UiRun } from "@schema/ui";
import { prettyPageLabel, sectionKey, titleCaseSegment } from "@ui/graph-labels";

export type GraphKind = UiGraphNode["kind"] | "section";

export type GraphNodeData = {
  kind: GraphKind;
  pageId: string;
  label: string;
  title: string;
  kicker?: string;
  path: string;
  origin?: string;
  entry?: boolean;
  red: number;
  yellow: number;
  rings: { hue: number; name: string }[];
  count?: number;
  collapsed?: boolean;
  section?: string;
};

export type GraphFlowNode = Node<GraphNodeData, "graph" | "section">;

export const PAGE_NODE = { width: 188, height: 56 } as const;
export const NESTED_PAGE = { width: 200, height: 44 } as const;
export const SECTION_NODE = { width: 236, height: 64 } as const;
export const DIALOG_NODE = { width: 160, height: 48 } as const;

const CHILD_GAP = 6;
const SECTION_PAD_X = 12;
const SECTION_PAD_TOP = 56;
const SECTION_PAD_BOTTOM = 12;

export function ringsFor(node: Pick<UiGraphNode, "id" | "kind">, runs: UiRun[]) {
  return runs
    .filter((run) => {
      if (!run.live || !run.pageId) return false;
      return run.pageId === node.id;
    })
    .map((run) => ({ hue: run.hue, name: run.name }));
}

export function clustersOf(graph: UiGraph): Map<string, UiGraphNode[]> {
  const pages = graph.nodes.filter((n) => n.kind === "page" && !n.entry);
  const buckets = new Map<string, UiGraphNode[]>();
  for (const page of pages) {
    const key = sectionKey(page.path);
    if (!key) continue;
    const list = buckets.get(key) ?? [];
    list.push(page);
    buckets.set(key, list);
  }
  for (const [key, list] of buckets) {
    if (list.length < 2) buckets.delete(key);
  }
  return buckets;
}

function isBackEdge(edge: { source: string; target: string }, depth: Map<string, number>): boolean {
  const a = depth.get(edge.source);
  const b = depth.get(edge.target);
  return a !== undefined && b !== undefined && b <= a;
}

function pageDepths(graph: UiGraph): Map<string, number> {
  const depth = new Map<string, number>();
  const pages = graph.nodes.filter((n) => n.kind === "page");
  const outgoing = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.source.includes("::") || e.target.includes("::")) continue;
    const list = outgoing.get(e.source) ?? [];
    list.push(e.target);
    outgoing.set(e.source, list);
  }
  const starts = pages.filter((n) => n.entry);
  const queue: string[] = (starts.length > 0 ? starts : pages.slice(0, 1)).map((n) => n.id);
  queue.forEach((id, i) => depth.set(id, starts.length > 0 ? i : 0));
  let qi = 0;
  while (qi < queue.length) {
    const id = queue[qi++]!;
    const d = depth.get(id) ?? 0;
    for (const to of outgoing.get(id) ?? []) {
      if (depth.has(to)) continue;
      depth.set(to, d + 1);
      queue.push(to);
    }
  }
  return depth;
}

function sectionId(key: string): string {
  return `section:${key}`;
}

function expandedSize(count: number): { width: number; height: number } {
  return {
    width: NESTED_PAGE.width + SECTION_PAD_X * 2,
    height: SECTION_PAD_TOP + count * NESTED_PAGE.height + Math.max(0, count - 1) * CHILD_GAP + SECTION_PAD_BOTTOM,
  };
}

export function layoutGraph(
  graph: UiGraph,
  runs: UiRun[],
  opts?: { expanded?: Set<string>; selectedId?: string | null; query?: string },
): { nodes: GraphFlowNode[]; edges: Edge[] } {
  const depth = pageDepths(graph);
  const clusters = clustersOf(graph);
  const clustered = new Map<string, string>();
  for (const [key, pages] of clusters) {
    for (const page of pages) clustered.set(page.id, key);
  }
  const expanded = opts?.expanded ?? new Set<string>();
  const query = opts?.query?.trim().toLowerCase();

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 36, ranksep: 110, marginx: 24, marginy: 24 });

  const macroId = (pageId: string): string => {
    const key = clustered.get(pageId);
    return key ? sectionId(key) : pageId;
  };

  for (const node of graph.nodes) {
    if (node.kind !== "page") continue;
    if (clustered.has(node.id)) continue;
    g.setNode(node.id, { width: PAGE_NODE.width, height: PAGE_NODE.height });
  }
  for (const [key, pages] of clusters) {
    const size = expanded.has(key) ? expandedSize(pages.length) : SECTION_NODE;
    g.setNode(sectionId(key), { width: size.width, height: size.height });
  }

  const seenMacro = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.source.includes("::") || edge.target.includes("::")) continue;
    if (isBackEdge(edge, depth)) continue;
    const source = macroId(edge.source);
    const target = macroId(edge.target);
    if (!g.hasNode(source) || !g.hasNode(target) || source === target) continue;
    const id = `${source}->${target}`;
    if (seenMacro.has(id)) continue;
    seenMacro.add(id);
    g.setEdge(source, target);
  }
  dagre.layout(g);

  const nodes: GraphFlowNode[] = [];
  const pagePos = new Map<string, { x: number; y: number }>();

  const matchesQuery = (node: UiGraphNode): boolean => {
    if (!query) return true;
    return (
      node.label.toLowerCase().includes(query) ||
      node.path.toLowerCase().includes(query) ||
      node.id.toLowerCase().includes(query)
    );
  };

  for (const node of graph.nodes) {
    if (node.kind !== "page") continue;
    if (clustered.has(node.id)) continue;
    const placed = g.node(node.id);
    const position = {
      x: (placed?.x ?? 0) - PAGE_NODE.width / 2,
      y: (placed?.y ?? 0) - PAGE_NODE.height / 2,
    };
    pagePos.set(node.id, position);
    const pretty = prettyPageLabel(node.path, node.id);
    const hidden = Boolean(query) && !matchesQuery(node);
    nodes.push({
      id: node.id,
      type: "graph",
      position,
      hidden,
      data: {
        kind: "page",
        pageId: node.pageId,
        label: node.label,
        title: pretty.title,
        kicker: pretty.kicker,
        path: node.path,
        origin: node.origin,
        entry: node.entry,
        red: node.red,
        yellow: node.yellow,
        rings: ringsFor(node, runs),
      },
      style: { width: PAGE_NODE.width, height: PAGE_NODE.height, opacity: hidden ? 0.18 : 1 },
      zIndex: 2,
    });
  }

  for (const [key, pages] of clusters) {
    const sid = sectionId(key);
    const placed = g.node(sid);
    const size = expanded.has(key) ? expandedSize(pages.length) : SECTION_NODE;
    const position = {
      x: (placed?.x ?? 0) - size.width / 2,
      y: (placed?.y ?? 0) - size.height / 2,
    };
    const red = pages.reduce((n, p) => n + p.red, 0);
    const yellow = pages.reduce((n, p) => n + p.yellow, 0);
    const rings = pages.flatMap((p) => ringsFor(p, runs));
    const anyMatch = pages.some((p) => matchesQuery(p));
    const hidden = Boolean(query) && !anyMatch;
    nodes.push({
      id: sid,
      type: "section",
      position,
      hidden,
      data: {
        kind: "section",
        pageId: sid,
        label: titleCaseSegment(key),
        title: titleCaseSegment(key),
        path: `/${key}`,
        red,
        yellow,
        rings,
        count: pages.length,
        collapsed: !expanded.has(key),
        section: key,
      },
      style: { width: size.width, height: size.height, opacity: hidden ? 0.18 : 1 },
      zIndex: 0,
    });

    if (!expanded.has(key)) continue;
    pages
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path))
      .forEach((page, i) => {
        const pretty = prettyPageLabel(page.path, page.id);
        const childHidden = Boolean(query) && !matchesQuery(page);
        pagePos.set(page.id, {
          x: position.x + SECTION_PAD_X,
          y: position.y + SECTION_PAD_TOP + i * (NESTED_PAGE.height + CHILD_GAP),
        });
        nodes.push({
          id: page.id,
          type: "graph",
          parentId: sid,
          extent: "parent",
          position: {
            x: SECTION_PAD_X,
            y: SECTION_PAD_TOP + i * (NESTED_PAGE.height + CHILD_GAP),
          },
          hidden: childHidden,
          data: {
            kind: "page",
            pageId: page.pageId,
            label: page.label,
            title: pretty.title,
            path: page.path,
            origin: page.origin,
            entry: page.entry,
            red: page.red,
            yellow: page.yellow,
            rings: ringsFor(page, runs),
            section: key,
          },
          style: { width: NESTED_PAGE.width, height: NESTED_PAGE.height, opacity: childHidden ? 0.18 : 1 },
          zIndex: 2,
        });
      });
  }

  const selectedPage = opts?.selectedId?.includes("::")
    ? opts.selectedId.slice(0, opts.selectedId.indexOf("::"))
    : opts?.selectedId;
  const dialogsByPage = new Map<string, UiGraphNode[]>();
  for (const node of graph.nodes) {
    if (node.kind !== "dialog") continue;
    if (selectedPage && node.pageId !== selectedPage) continue;
    const list = dialogsByPage.get(node.pageId) ?? [];
    list.push(node);
    dialogsByPage.set(node.pageId, list);
  }
  for (const [pageId, dialogs] of dialogsByPage) {
    const parent = pagePos.get(pageId);
    if (!parent) continue;
    dialogs.forEach((node, i) => {
      nodes.push({
        id: node.id,
        type: "graph",
        position: {
          x: parent.x + NESTED_PAGE.width + 16,
          y: parent.y + i * (DIALOG_NODE.height + 6),
        },
        data: {
          kind: "dialog",
          pageId: node.pageId,
          label: node.label,
          title: node.label.replace(/[_-]/g, " "),
          path: node.path,
          origin: node.origin,
          red: 0,
          yellow: 0,
          rings: ringsFor(node, runs),
        },
        style: { width: DIALOG_NODE.width, height: DIALOG_NODE.height },
      });
    });
  }

  const visible = new Set(nodes.filter((n) => !n.hidden).map((n) => n.id));
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.source.includes("::") || edge.target.includes("::")) {
      if (!visible.has(edge.source) || !visible.has(edge.target)) continue;
      edges.push({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: "smoothstep",
        style: { stroke: "#52525b", strokeWidth: 1 },
      });
      continue;
    }
    const back = isBackEdge(edge, depth);
    let source = edge.source;
    let target = edge.target;
    if (!expanded.has(clustered.get(source) ?? "") && clustered.has(source)) source = sectionId(clustered.get(source)!);
    if (!expanded.has(clustered.get(target) ?? "") && clustered.has(target)) target = sectionId(clustered.get(target)!);
    if (source === target) continue;
    if (!visible.has(source) || !visible.has(target)) continue;
    const id = `${source}->${target}`;
    if (seen.has(id)) continue;
    seen.add(id);
    edges.push({
      id,
      source,
      target,
      type: "smoothstep",
      hidden: back,
      style: {
        stroke: back ? "#27272a" : "#3f3f46",
        strokeWidth: 1,
      },
    });
  }

  return { nodes, edges };
}

export function defaultExpanded(graph: UiGraph, runs: UiRun[]): Set<string> {
  const live = new Set(runs.filter((r) => r.live && r.pageId).map((r) => r.pageId!));
  const clusters = clustersOf(graph);
  const open = new Set<string>();
  if (graph.nodes.filter((n) => n.kind === "page").length <= 16) {
    for (const key of clusters.keys()) open.add(key);
    return open;
  }
  for (const [key, pages] of clusters) {
    if (pages.some((p) => live.has(p.id))) open.add(key);
  }
  return open;
}
