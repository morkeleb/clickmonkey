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
  NEST_COL_GAP,
  NODE_SEP,
  PAGE_NODE,
  RANK_SEP,
  SECTION_NODE,
  nestColumns,
  pageBoxSize,
  type LayoutBox,
} from "./layout-metrics";

export {
  DIALOG_NODE,
  NESTED_PAGE,
  PAGE_NODE,
  SECTION_NODE,
  dialogRailWidth,
  nestColumns,
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
  fogAt?: string;
  jobFog?: { map?: string; unleash?: string; nasty?: string; spec?: string };
};

export type GraphFlowNode = Node<GraphNodeData, "graph" | "section">;

/** Overflow "Active tabs: N" chips — shell chrome, not a room on the map. */
function isChromeTabDialog(id: string): boolean {
  return id === "active_tabs" || /^active_tabs_/.test(id);
}

function selectedPageId(selectedId?: string | null): string | undefined {
  if (!selectedId) return undefined;
  const cut = selectedId.indexOf("::");
  return cut >= 0 ? selectedId.slice(0, cut) : selectedId;
}

function groupDialogs(graph: UiGraph, selectedPage?: string): Map<string, UiGraphNode[]> {
  const dialogsByPage = new Map<string, UiGraphNode[]>();
  if (!selectedPage) return dialogsByPage;
  for (const node of graph.nodes) {
    if (node.kind !== "dialog") continue;
    if (node.pageId !== selectedPage) continue;
    const surfaceId = node.id.includes("::") ? node.id.slice(node.id.indexOf("::") + 2) : node.label;
    if (isChromeTabDialog(surfaceId) || isChromeTabDialog(node.label)) continue;
    const list = dialogsByPage.get(node.pageId) ?? [];
    list.push(node);
    dialogsByPage.set(node.pageId, list);
  }
  for (const list of dialogsByPage.values()) list.sort(byId);
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
  const pages = graph.nodes
    .filter((n) => n.kind === "page" && !n.entry)
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path) || a.id.localeCompare(b.id));
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

function clusterEntries(clusters: Map<string, UiGraphNode[]>): Array<[string, UiGraphNode[]]> {
  return [...clusters.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id.localeCompare(b.id);
}

function isBackEdge(edge: { source: string; target: string }, depth: Map<string, number>): boolean {
  const a = depth.get(edge.source);
  const b = depth.get(edge.target);
  return a !== undefined && b !== undefined && b <= a;
}

function pageDepths(graph: UiGraph): Map<string, number> {
  const depth = new Map<string, number>();
  const pages = graph.nodes.filter((n) => n.kind === "page").slice().sort(byId);
  const outgoing = new Map<string, string[]>();
  const pageEdges = graph.edges
    .filter((e) => !e.source.includes("::") && !e.target.includes("::"))
    .slice()
    .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
  for (const e of pageEdges) {
    const list = outgoing.get(e.source) ?? [];
    list.push(e.target);
    outgoing.set(e.source, list);
  }
  for (const list of outgoing.values()) list.sort((a, b) => a.localeCompare(b));
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

function expandedSize(pages: UiGraphNode[]): { width: number; height: number } {
  const cols = nestColumns(pages.length);
  const sorted = pages.slice().sort((a, b) => a.path.localeCompare(b.path));
  const colH = Array.from({ length: cols }, () => SECTION_PAD_TOP);
  sorted.forEach((_, i) => {
    const box = pageBoxSize(NESTED_PAGE, 0);
    const col = i % cols;
    if (colH[col]! > SECTION_PAD_TOP) colH[col]! += CHILD_GAP;
    colH[col]! += box.height;
  });
  return {
    width: cols * NESTED_PAGE.width + (cols - 1) * NEST_COL_GAP + SECTION_PAD_X * 2,
    height: Math.max(...colH) + SECTION_PAD_BOTTOM,
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
  g.setGraph({
    rankdir: "LR",
    align: "UL",
    ranker: "tight-tree",
    nodesep: NODE_SEP,
    ranksep: RANK_SEP,
    marginx: 24,
    marginy: 24,
  });

  const macroId = (pageId: string): string => {
    const key = clustered.get(pageId);
    return key ? sectionId(key) : pageId;
  };

  const dagreBox = new Map<string, { width: number; height: number }>();
  const unclustered = graph.nodes
    .filter((n) => n.kind === "page" && !clustered.has(n.id))
    .slice()
    .sort(byId);
  for (const node of unclustered) {
    const box = pageBoxSize(PAGE_NODE, 0);
    dagreBox.set(node.id, box);
    g.setNode(node.id, box);
  }
  for (const [key, pages] of clusterEntries(clusters)) {
    const inner = expanded.has(key) ? expandedSize(pages) : { ...SECTION_NODE };
    dagreBox.set(sectionId(key), inner);
    g.setNode(sectionId(key), inner);
  }

  const seenMacro = new Set<string>();
  const macroEdges: Array<{ source: string; target: string }> = [];
  for (const edge of graph.edges) {
    if (edge.source.includes("::") || edge.target.includes("::")) continue;
    if (isBackEdge(edge, depth)) continue;
    const source = macroId(edge.source);
    const target = macroId(edge.target);
    if (!g.hasNode(source) || !g.hasNode(target) || source === target) continue;
    const id = `${source}->${target}`;
    if (seenMacro.has(id)) continue;
    seenMacro.add(id);
    macroEdges.push({ source, target });
  }
  macroEdges.sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
  for (const edge of macroEdges) g.setEdge(edge.source, edge.target);
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

  for (const node of unclustered) {
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
      width: box.width,
      height: box.height,
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
        ...(node.fogAt ? { fogAt: node.fogAt } : {}),
        ...(node.jobFog ? { jobFog: node.jobFog } : {}),
      },
      style: { width: box.width, height: box.height, opacity: hidden ? 0.18 : 1 },
      zIndex: 2,
    });
  }

  for (const [key, pages] of clusterEntries(clusters)) {
    const sid = sectionId(key);
    const placed = g.node(sid);
    const size = expanded.has(key) ? expandedSize(pages) : { ...SECTION_NODE };
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
      width: size.width,
      height: size.height,
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
    const cols = nestColumns(pages.length);
    const colY = Array.from({ length: cols }, () => SECTION_PAD_TOP);
    for (const [i, page] of sorted.entries()) {
      const pretty = prettyPageLabel(page.path, page.id);
      const childHidden = Boolean(query) && !matchesQuery(page);
      const box = pageBoxSize(NESTED_PAGE, 0);
      const col = i % cols;
      const childX = SECTION_PAD_X + col * (NESTED_PAGE.width + NEST_COL_GAP);
      const childY = colY[col]!;
      pagePos.set(page.id, {
        x: position.x + childX,
        y: position.y + childY,
      });
      nodes.push({
        id: page.id,
        type: "graph",
        parentId: sid,
        extent: "parent",
        position: {
          x: childX,
          y: childY,
        },
        hidden: childHidden,
        width: box.width,
        height: box.height,
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
          ...(page.fogAt ? { fogAt: page.fogAt } : {}),
          ...(page.jobFog ? { jobFog: page.jobFog } : {}),
        },
        style: { width: box.width, height: box.height, opacity: childHidden ? 0.18 : 1 },
        zIndex: 2,
      });
      colY[col]! += box.height + CHILD_GAP;
    }
  }

  const dialogPages = [...dialogsByPage.keys()].sort((a, b) => a.localeCompare(b));
  for (const pageId of dialogPages) {
    const dialogs = dialogsByPage.get(pageId)!;
    const parent = pagePos.get(pageId);
    if (!parent) continue;
    const parentNode = nodes.find((n) => n.id === pageId);
    const parentHidden = Boolean(parentNode?.hidden);
    const clusteredKey = clustered.get(pageId);
    const nestCols = clusteredKey ? nestColumns(clusters.get(clusteredKey)?.length ?? 0) : 1;
    const pageRelX = clusteredKey
      ? (nodes.find((n) => n.id === pageId)?.position.x ?? SECTION_PAD_X)
      : 0;
    const railLeft =
      clusteredKey && nestCols > 1
        ? SECTION_PAD_X + nestCols * NESTED_PAGE.width + (nestCols - 1) * NEST_COL_GAP + DIALOG_GAP_X - pageRelX
        : (clustered.has(pageId) ? NESTED_PAGE.width : PAGE_NODE.width) + DIALOG_GAP_X;
    dialogs.forEach((node, i) => {
      nodes.push({
        id: node.id,
        type: "graph",
        parentId: pageId,
        position: {
          x: railLeft,
          y: i * (DIALOG_NODE.height + DIALOG_GAP_Y),
        },
        hidden: parentHidden,
        width: DIALOG_NODE.width,
        height: DIALOG_NODE.height,
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
  const pageEdges = graph.edges
    .filter((e) => !e.source.includes("::") && !e.target.includes("::"))
    .slice()
    .sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
  for (const edge of pageEdges) {
    const back = isBackEdge(edge, depth);
    const srcKey = clustered.get(edge.source);
    const tgtKey = clustered.get(edge.target);
    let source = edge.source;
    let target = edge.target;
    if (srcKey && srcKey === tgtKey) {
      if (!expanded.has(srcKey)) continue;
    } else {
      if (srcKey) source = sectionId(srcKey);
      if (tgtKey) target = sectionId(tgtKey);
    }
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
  edges.sort((a, b) => a.id.localeCompare(b.id));

  return { nodes: sortFlowNodes(nodes), edges };
}

function sortFlowNodes(nodes: GraphFlowNode[]): GraphFlowNode[] {
  const byNodeId = new Map(nodes.map((n) => [n.id, n]));
  const depthOf = (node: GraphFlowNode): number => {
    let d = 0;
    let parentId = node.parentId;
    while (parentId) {
      d += 1;
      parentId = byNodeId.get(parentId)?.parentId;
    }
    return d;
  };
  return nodes.slice().sort((a, b) => {
    const dd = depthOf(a) - depthOf(b);
    if (dd !== 0) return dd;
    return a.id.localeCompare(b.id);
  });
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

export function defaultExpanded(graph: UiGraph, _runs?: UiRun[]): Set<string> {
  return new Set(clustersOf(graph).keys());
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a) {
    if (!b.has(key)) return false;
  }
  return true;
}

/**
 * Keep the user's collapse. `seen` is cluster keys from the last layout;
 * keys in `seen` but missing from `prev` stay collapsed. Brand-new clusters open.
 */
export function mergeExpanded(prev: Set<string>, graph: UiGraph, seen?: Iterable<string>): Set<string> {
  const valid = new Set(clustersOf(graph).keys());
  const known = new Set(seen ?? prev);
  const next = new Set<string>();
  for (const key of valid) {
    if (prev.has(key) || !known.has(key)) next.add(key);
  }
  return sameSet(prev, next) ? prev : next;
}

function flowStructureKey(node: GraphFlowNode): string {
  return [
    node.id,
    node.type ?? "",
    node.parentId ?? "",
    node.hidden ? "1" : "0",
    node.position.x,
    node.position.y,
    String(node.style?.width ?? node.width ?? ""),
    String(node.style?.height ?? node.height ?? ""),
  ].join("\t");
}

export function sameFlowNodes(a: GraphFlowNode[], b: GraphFlowNode[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (flowStructureKey(x) !== flowStructureKey(y)) return false;
    if (JSON.stringify(x.data) !== JSON.stringify(y.data)) return false;
  }
  return true;
}

/** Patch live rings/fog onto existing flow nodes so React Flow does not remount cards. */
export function adoptFlowNodes(prev: GraphFlowNode[], next: GraphFlowNode[]): GraphFlowNode[] {
  if (sameFlowNodes(prev, next)) return prev;
  const prevById = new Map(prev.map((n) => [n.id, n]));
  const selected = new Set(prev.filter((n) => n.selected).map((n) => n.id));
  return next.map((node) => {
    const old = prevById.get(node.id);
    const isSelected = selected.has(node.id);
    if (!old) return isSelected ? { ...node, selected: true } : node;
    const dataSame = JSON.stringify(old.data) === JSON.stringify(node.data);
    if (flowStructureKey(old) === flowStructureKey(node) && dataSame && Boolean(old.selected) === isSelected) {
      return old;
    }
    const sameBox =
      (old.width ?? old.style?.width) === (node.width ?? node.style?.width) &&
      (old.height ?? old.style?.height) === (node.height ?? node.style?.height);
    return {
      ...old,
      ...node,
      selected: isSelected,
      data: node.data,
      width: node.width ?? old.width,
      height: node.height ?? old.height,
      measured: sameBox ? old.measured : undefined,
    };
  });
}
