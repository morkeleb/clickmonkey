import { sameLedgerPage } from "../schema/testability.js";
import type { PageModelDraft } from "../schema/page-model.js";
import type { QualityReport } from "../schema/quality.js";
import type { TestabilityReport } from "../schema/testability.js";
import type { FindingCase } from "../persist/runs.js";
import type { UiGraph, UiGraphEdge, UiGraphNode } from "../schema/ui.js";
import { prettyPageLabel } from "./graph-labels.js";

function pathOfHref(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const path = new URL(url).pathname;
    return path === "" ? "/" : path;
  } catch {
    return undefined;
  }
}

function nodeLabel(page: { id: string; path: string }): string {
  const pretty = prettyPageLabel(page.path, page.id);
  return pretty.kicker ? `${pretty.kicker} / ${pretty.title}` : pretty.title;
}

export function badgeCounts(opts: {
  path: string;
  origin?: string;
  testability?: TestabilityReport;
  quality?: QualityReport;
  findings?: FindingCase[];
}): { red: number; yellow: number } {
  let red = 0;
  let yellow = 0;
  const key = { path: opts.path, origin: opts.origin };
  const t = opts.testability?.pages.find((p) => sameLedgerPage(p, key));
  if (t) {
    for (const i of t.issues) {
      if (i.severity === "block") red += 1;
      else yellow += 1;
    }
  }
  const q = opts.quality?.pages.find((p) => sameLedgerPage(p, key));
  if (q) {
    for (const i of [...q.html, ...q.a11y, ...q.runtime]) {
      if (i.severity === "error") red += 1;
      else yellow += 1;
    }
  }
  for (const c of opts.findings ?? []) {
    const findingPath = pathOfHref(c.finding.url);
    if (!findingPath || findingPath !== opts.path) continue;
    if (c.severity === "critical" || c.severity === "major") red += 1;
    else yellow += 1;
  }
  return { red, yellow };
}

/** pageId transitions recorded in nav.jsonl (step/nav/land). */
export function hopsFromNavLog(text: string): Array<{ from: string; to: string }> {
  const hops: Array<{ from: string; to: string }> = [];
  let last: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let ev: { pageId?: unknown; type?: unknown };
    try {
      ev = JSON.parse(raw) as { pageId?: unknown; type?: unknown };
    } catch {
      continue;
    }
    const pageId = typeof ev.pageId === "string" && ev.pageId ? ev.pageId : undefined;
    if (!pageId) continue;
    if (last && last !== pageId) hops.push({ from: last, to: pageId });
    last = pageId;
  }
  return hops;
}

function addEdge(edges: UiGraphEdge[], source: string, target: string, label?: string): void {
  if (source === target) return;
  if (edges.some((e) => e.source === source && e.target === target)) return;
  edges.push({
    id: `${source}->${target}`,
    source,
    target,
    ...(label ? { label } : {}),
  });
}

function seedEntryHops(map: PageModelDraft, edges: UiGraphEdge[]): void {
  const pages = map.pages;
  const entries = pages.filter((p) => p.entry);
  for (let i = 0; i < entries.length - 1; i++) {
    addEdge(edges, entries[i]!.id, entries[i + 1]!.id);
  }
  const lastEntry = entries[entries.length - 1];
  const firstApp = pages.find((p) => !p.entry);
  if (lastEntry && firstApp) addEdge(edges, lastEntry.id, firstApp.id);
}

function attachOrphans(map: PageModelDraft, edges: UiGraphEdge[]): void {
  const incoming = new Set(edges.map((e) => e.target));
  const firstApp = map.pages.find((p) => !p.entry) ?? map.pages[0];
  if (!firstApp) return;
  for (const page of map.pages) {
    if (page.id === firstApp.id) continue;
    if (page.entry) continue;
    if (incoming.has(page.id)) continue;
    addEdge(edges, firstApp.id, page.id);
  }
}

export function buildUiGraph(
  map: PageModelDraft,
  opts?: {
    testability?: TestabilityReport;
    quality?: QualityReport;
    findings?: FindingCase[];
    hops?: Array<{ from: string; to: string; label?: string }>;
  },
): UiGraph {
  const nodes: UiGraphNode[] = [];
  const edges: UiGraphEdge[] = [];
  const pageIds = new Set(map.pages.map((p) => p.id));
  seedEntryHops(map, edges);

  for (const hop of opts?.hops ?? []) {
    if (!pageIds.has(hop.from) || !pageIds.has(hop.to) || hop.from === hop.to) continue;
    addEdge(edges, hop.from, hop.to, hop.label);
  }
  attachOrphans(map, edges);

  for (const page of map.pages) {
    const badges = badgeCounts({
      path: page.path,
      origin: page.origin,
      testability: opts?.testability,
      quality: opts?.quality,
      findings: opts?.findings,
    });
    nodes.push({
      id: page.id,
      kind: "page",
      pageId: page.id,
      label: nodeLabel(page),
      path: page.path,
      red: badges.red,
      yellow: badges.yellow,
      ...(page.origin ? { origin: page.origin } : {}),
      ...(page.entry ? { entry: true } : {}),
    });

    for (const surface of page.surfaces) {
      if (surface.kind !== "dialog") continue;
      const dialogId = `${page.id}::${surface.id}`;
      nodes.push({
        id: dialogId,
        kind: "dialog",
        pageId: page.id,
        label: surface.id,
        path: page.path,
        red: 0,
        yellow: 0,
        ...(page.origin ? { origin: page.origin } : {}),
      });
      const opener = page.surfaces
        .flatMap((s) => s.actions)
        .find((a) => a.opens === surface.id);
      edges.push({
        id: `${page.id}->${dialogId}`,
        source: page.id,
        target: dialogId,
        ...(opener ? { label: opener.id } : {}),
      });
    }

    for (const surface of page.surfaces) {
      for (const action of surface.actions) {
        if (!action.opens || !pageIds.has(action.opens)) continue;
        const id = `${page.id}->${action.opens}:${action.id}`;
        if (edges.some((e) => e.id === id)) continue;
        edges.push({
          id,
          source: page.id,
          target: action.opens,
          label: action.id,
        });
      }
    }
  }

  return { nodes, edges };
}
