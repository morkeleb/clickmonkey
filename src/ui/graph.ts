import type { PageModelDraft } from "../schema/page-model.js";
import type { FindingCase } from "../persist/runs.js";
import type { UiGraph, UiGraphEdge, UiGraphNode } from "../schema/ui.js";
import { ledgerPath } from "../surveyor/path-template.js";
import { prettyPageLabel } from "./graph-labels.js";
import { isActiveTabsSurfaceId } from "../surveyor/ids.js";

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

export function findingOnPage(
  finding: { pageId?: string; url?: string; finding?: { url?: string } },
  page: { id: string; path: string },
): boolean {
  if (finding.pageId) return finding.pageId === page.id;
  const href = finding.url ?? finding.finding?.url;
  const findingPath = pathOfHref(href);
  if (!findingPath) return false;
  return ledgerPath(findingPath) === ledgerPath(page.path);
}

/** Red/yellow pills are finding folders, same objects as the sidebar run list. */
export function badgeCounts(opts: {
  pageId: string;
  path: string;
  findings?: Array<{ pageId?: string; url?: string; finding?: { url?: string }; severity: string }>;
}): { red: number; yellow: number } {
  let red = 0;
  let yellow = 0;
  const page = { id: opts.pageId, path: opts.path };
  for (const c of opts.findings ?? []) {
    if (!findingOnPage(c, page)) continue;
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

/**
 * Same action id opening the same page on this many rooms is chrome
 * (Dashboard tab, sidebar Settings), not a door on the map.
 */
export const CHROME_OPEN_PAGES = 4;

/** `/accounts-payable/vouchers` → `/accounts-payable/vouchers/new`, not sidebar chrome. */
export function isLocalPageOpen(fromPath: string, toPath: string): boolean {
  const a = fromPath.replace(/\/+$/, "") || "/";
  const b = toPath.replace(/\/+$/, "") || "/";
  if (a === "/" || a === b) return false;
  return b === `${a}/new` || b === `${a}/edit` || b === `${a}/create` || b.startsWith(`${a}/`);
}

function chromeOpenKeys(map: PageModelDraft): Set<string> {
  const counts = new Map<string, number>();
  for (const page of map.pages) {
    const seen = new Set<string>();
    for (const surface of page.surfaces) {
      for (const action of surface.actions) {
        if (!action.opens) continue;
        const key = `${action.id}\t${action.opens}`;
        if (seen.has(key)) continue;
        seen.add(key);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  const chrome = new Set<string>();
  for (const [key, n] of counts) {
    if (n >= CHROME_OPEN_PAGES) chrome.add(key);
  }
  return chrome;
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
  const hub = appHub(map);
  if (lastEntry && hub && lastEntry.id !== hub.id) addEdge(edges, lastEntry.id, hub.id);
}

function appHub(map: PageModelDraft): PageModelDraft["pages"][number] | undefined {
  return (
    map.pages.find((p) => p.path === "/" || p.id === "home") ??
    map.pages.find((p) => !p.entry) ??
    map.pages[0]
  );
}

function attachOrphans(map: PageModelDraft, edges: UiGraphEdge[]): void {
  const incoming = new Set(edges.map((e) => e.target));
  const hub = appHub(map);
  if (!hub) return;
  for (const page of map.pages) {
    if (page.id === hub.id) continue;
    if (page.entry && page.path !== "/") continue;
    if (incoming.has(page.id)) continue;
    addEdge(edges, hub.id, page.id);
  }
}

export function buildUiGraph(
  map: PageModelDraft,
  opts?: {
    findings?: FindingCase[];
    hops?: Array<{ from: string; to: string; label?: string }>;
  },
): UiGraph {
  const nodes: UiGraphNode[] = [];
  const edges: UiGraphEdge[] = [];
  const pageIds = new Set(map.pages.map((p) => p.id));
  const pageById = new Map(map.pages.map((p) => [p.id, p]));
  const chromeOpens = chromeOpenKeys(map);
  seedEntryHops(map, edges);

  for (const hop of opts?.hops ?? []) {
    if (!pageIds.has(hop.from) || !pageIds.has(hop.to) || hop.from === hop.to) continue;
    addEdge(edges, hop.from, hop.to, hop.label);
  }
  attachOrphans(map, edges);

  for (const page of map.pages) {
    const badges = badgeCounts({
      pageId: page.id,
      path: page.path,
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
      ...(page.description ? { blurb: page.description } : {}),
      ...(page.describedBy ? { describedBy: page.describedBy } : {}),
    });

    for (const surface of page.surfaces) {
      if (surface.kind !== "dialog") continue;
      if (isActiveTabsSurfaceId(surface.id)) continue;
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
        if (chromeOpens.has(`${action.id}\t${action.opens}`)) continue;
        const dest = pageById.get(action.opens);
        if (!dest || !isLocalPageOpen(page.path, dest.path)) continue;
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
