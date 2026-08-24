import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import { monkeyOfBrain } from "@schema/fog";
import type { UiGraph, UiGraphNode, UiRun } from "@schema/ui";
import { prettyPageLabel, sectionKey, titleCaseSegment } from "@ui/graph-labels";
import {
  DIALOG_GAP_X,
  DIALOG_GAP_Y,
  DIALOG_NODE,
  NESTED_PAGE,
  NODE_SEP,
  PAGE_NODE,
  RANK_SEP,
  SECTION_NODE,
  dialogRailWidth,
  pageBoxSize,
  type LayoutBox,
} from "./layout-metrics";

export {
  DIALOG_NODE,
  NESTED_PAGE,
  PAGE_NODE,
  SECTION_NODE,
  dialogRailWidth,
  pageBoxSize,
} from "./layout-metrics";
export type { LayoutBox } from "./layout-metrics";

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
  rings: { hue: number; name: string; monkey?: string }[];
  blurb?: string;
  describedBy?: "inspect" | "explore" | "vision";
  count?: number;
  collapsed?: boolean;
  section?: string;
  /** Visual card size when the flow node is a larger bounding box (page + dialog rail). */
  cardWidth?: number;
  cardHeight?: number;
  lastLandAt?: string;
  jobLands?: { map?: string; unleash?: string; nasty?: string };
};

export type GraphFlowNode = Node<GraphNodeData, "graph" | "section">;

function selectedPageId(selectedId?: string | null): string | undefined {
  if (!selectedId) return undefined;
  const cut = selectedId.indexOf("::");
  return cut >= 0 ? selectedId.slice(0, cut) : selectedId;
}

function groupDialogs(graph: UiGraph, selectedPage?: string): Map<string, UiGraphNode[]> {
  const dialogsByPage = new Map<string, UiGraphNode[]>();
  for (const node of graph.nodes) {
    if (node.kind !== "dialog") continue;
    if (selectedPage && node.pageId !== selectedPage) continue;
    const list = dialogsByPage.get(node.pageId) ?? [];
    list.push(node);
    dialogsByPage.set(node.pageId, list);
  }
  return dialogsByPage;
}

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
    .map((run) => {
      const monkey = monkeyOfBrain(run.brain);
      return { hue: run.hue, name: run.name, ...(monkey ? { monkey } : {}) };
    });
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

function expandedSize(
  pages: UiGraphNode[],
  dialogsByPage: Map<string, UiGraphNode[]>,
): { width: number; height: number } {
  const sorted = pages.slice().sort((a, b) => a.path.localeCompare(b.path));
  let height = SECTION_PAD_TOP + SECTION_PAD_BOTTOM;
  let rail = 0;
  sorted.forEach((page, i) => {
    const n = dialogsByPage.get(page.id)?.length ?? 0;
    const box = pageBoxSize(NESTED_PAGE, n);
    height += box.height;
    if (i > 0) height += CHILD_GAP;
    rail = Math.max(rail, dialogRailWidth(n));
  });
  return {
    width: NESTED_PAGE.width + SECTION_PAD_X * 2 + rail,
    height,
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
  const dialogsByPage = groupDialogs(graph, selectedPageId(opts?.selectedId));

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({ width: 0, height: 0 }));
  g.setGraph({ rankdir: "LR", nodesep: NODE_SEP, ranksep: RANK_SEP, marginx: 24, marginy: 24 });

  const macroId = (pageId: string): string => {
    const key = clustered.get(pageId);
    return key ? sectionId(key) : pageId;
  };

  const dagreBox = new Map<string, { width: number; height: number }>();
  for (const node of graph.nodes) {
    if (node.kind !== "page") continue;
    if (clustered.has(node.id)) continue;
    const box = pageBoxSize(PAGE_NODE, dialogsByPage.get(node.id)?.length ?? 0);
    dagreBox.set(node.id, box);
    g.setNode(node.id, box);
  }
  for (const [key, pages] of clusters) {
    const inner = expanded.has(key) ? expandedSize(pages, dialogsByPage) : { ...SECTION_NODE };
    dagreBox.set(sectionId(key), inner);
    g.setNode(sectionId(key), inner);
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
      node.id.toLowerCase().includes(query) ||
      (node.blurb?.toLowerCase().includes(query) ?? false)
    );
  };

  for (const node of graph.nodes) {
    if (node.kind !== "page") continue;
    if (clustered.has(node.id)) continue;
    const placed = g.node(node.id);
    const box = dagreBox.get(node.id) ?? PAGE_NODE;
    const position = {
      x: (placed?.x ?? 0) - box.width / 2,
      y: (placed?.y ?? 0) - box.height / 2,
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
        cardWidth: PAGE_NODE.width,
        cardHeight: PAGE_NODE.height,
        ...(node.blurb ? { blurb: node.blurb } : {}),
        ...(node.describedBy ? { describedBy: node.describedBy } : {}),
        ...(node.lastLandAt ? { lastLandAt: node.lastLandAt } : {}),
        ...(node.jobLands ? { jobLands: node.jobLands } : {}),
      },
      style: { width: box.width, height: box.height, opacity: hidden ? 0.18 : 1 },
      zIndex: 2,
    });
  }

  for (const [key, pages] of clusters) {
    const sid = sectionId(key);
    const placed = g.node(sid);
    const size = expanded.has(key) ? expandedSize(pages, dialogsByPage) : { ...SECTION_NODE };
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
    const sorted = pages.slice().sort((a, b) => a.path.localeCompare(b.path));
    let childY = SECTION_PAD_TOP;
    for (const page of sorted) {
      const pretty = prettyPageLabel(page.path, page.id);
      const childHidden = Boolean(query) && !matchesQuery(page);
      const box = pageBoxSize(NESTED_PAGE, dialogsByPage.get(page.id)?.length ?? 0);
      pagePos.set(page.id, {
        x: position.x + SECTION_PAD_X,
        y: position.y + childY,
      });
      nodes.push({
        id: page.id,
        type: "graph",
        parentId: sid,
        extent: "parent",
        position: {
          x: SECTION_PAD_X,
          y: childY,
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
          cardWidth: NESTED_PAGE.width,
          cardHeight: NESTED_PAGE.height,
          ...(page.blurb ? { blurb: page.blurb } : {}),
          ...(page.describedBy ? { describedBy: page.describedBy } : {}),
          ...(page.lastLandAt ? { lastLandAt: page.lastLandAt } : {}),
          ...(page.jobLands ? { jobLands: page.jobLands } : {}),
        },
        style: { width: box.width, height: box.height, opacity: childHidden ? 0.18 : 1 },
        zIndex: 2,
      });
      childY += box.height + CHILD_GAP;
    }
  }

  for (const [pageId, dialogs] of dialogsByPage) {
    const parent = pagePos.get(pageId);
    if (!parent) continue;
    const parentNode = nodes.find((n) => n.id === pageId);
    const parentHidden = Boolean(parentNode?.hidden);
    const cardW = clustered.has(pageId) ? NESTED_PAGE.width : PAGE_NODE.width;
    dialogs.forEach((node, i) => {
      nodes.push({
        id: node.id,
        type: "graph",
        parentId: pageId,
        position: {
          x: cardW + DIALOG_GAP_X,
          y: i * (DIALOG_NODE.height + DIALOG_GAP_Y),
        },
        hidden: parentHidden,
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
        zIndex: 3,
      });
    });
  }

  const visible = new Set(nodes.filter((n) => !n.hidden).map((n) => n.id));
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.source.includes("::") || edge.target.includes("::")) continue;
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

export function absoluteBoxes(nodes: GraphFlowNode[]): LayoutBox[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const abs = (node: GraphFlowNode): { x: number; y: number } => {
    const pos = { x: node.position.x, y: node.position.y };
    let parentId = node.parentId;
    while (parentId) {
      const parent = byId.get(parentId);
      if (!parent) break;
      pos.x += parent.position.x;
      pos.y += parent.position.y;
      parentId = parent.parentId;
    }
    return pos;
  };
  return nodes
    .filter((n) => !n.hidden)
    .map((n) => {
      const p = abs(n);
      return {
        id: n.id,
        x: p.x,
        y: p.y,
        width: Number(n.style?.width ?? 0),
        height: Number(n.style?.height ?? 0),
      };
    });
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
