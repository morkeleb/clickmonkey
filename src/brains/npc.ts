import { formatStep } from "../schema/dsl.js";
import { fogHunger } from "../schema/fog.js";
import type { Action, Page } from "../schema/page-model.js";
import type { ShownAction } from "../schema/view.js";
import type { BrainContext } from "./types.js";
import { formatClick, usableClicks } from "./unleash.js";

export { fogHunger, FOG_FRESH_MS, FOG_OLD_MS, staleMsForPage } from "../schema/fog.js";

export type NpcNode = { page: string; surface: string };

export type NpcEdge =
  | { kind: "open"; page: string }
  | { kind: "click"; surface: string; id: string; nav?: boolean };

export type NpcReach = {
  dist: number;
  first?: NpcEdge;
};

export type NpcGoal = {
  key: string;
  hunger: number;
};

export type NpcPlan = {
  goal: string;
  dist: number;
  step: NpcEdge;
};

export function npcKey(node: { page: string; surface: string }): string {
  return `${node.page}/${node.surface}`;
}

export function pageSurfaceId(page: Page): string {
  return page.surfaces.find((s) => s.kind === "page")?.id ?? page.id;
}

/** This-run visit term × fog (last land). */
export function npcHunger(hits: number, staleMs: number): number {
  return (1 / (1 + Math.max(0, hits))) * fogHunger(staleMs);
}

export function npcScore(hits: number, dist: number, staleMs: number): number {
  return npcHunger(hits, staleMs) * (1 + 1 / (1 + Math.max(0, dist)));
}

function okAction(action: Action): boolean {
  return (action.status ?? "ok") === "ok";
}

function pageById(pages: readonly Page[], id: string): Page | undefined {
  return pages.find((p) => p.id === id);
}

function clickEdge(surface: string, action: { id: string; nav?: boolean }): NpcEdge {
  return { kind: "click", surface, id: action.id, ...(action.nav ? { nav: true } : {}) };
}

function neighbors(
  node: NpcNode,
  opts: {
    pages: readonly Page[];
    hoppable: readonly string[];
    live?: readonly ShownAction[];
    fromLive: boolean;
  },
): Array<{ to: NpcNode; edge: NpcEdge }> {
  const out: Array<{ to: NpcNode; edge: NpcEdge }> = [];
  const seen = new Set<string>();
  const push = (to: NpcNode, edge: NpcEdge) => {
    const key = `${npcKey(to)}\0${edge.kind}:${edge.kind === "open" ? edge.page : edge.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ to, edge });
  };

  for (const hop of opts.hoppable) {
    const dest = pageById(opts.pages, hop);
    const surface = dest ? pageSurfaceId(dest) : "page";
    if (hop === node.page && surface === node.surface) continue;
    push({ page: hop, surface }, { kind: "open", page: hop });
  }

  const page = pageById(opts.pages, node.page);
  const mapped =
    page?.surfaces
      .find((s) => s.id === node.surface)
      ?.actions.filter(okAction)
      .map((a) => ({
        id: a.id,
        ...(a.opens ? { opens: a.opens } : {}),
      })) ?? [];
  const actions = opts.fromLive && opts.live ? opts.live : mapped;

  for (const action of actions) {
    if (!action.opens) continue;
    const destPage = pageById(opts.pages, action.opens);
    if (destPage) {
      push({ page: destPage.id, surface: pageSurfaceId(destPage) }, clickEdge(node.surface, action));
      continue;
    }
    if (opts.hoppable.includes(action.opens)) {
      push({ page: action.opens, surface: "page" }, clickEdge(node.surface, action));
      continue;
    }
    if (page?.surfaces.some((s) => s.id === action.opens)) {
      push({ page: node.page, surface: action.opens }, clickEdge(node.surface, action));
    }
  }
  return out;
}

/** Distances and first step from here to every reachable sitemap node. */
export function floodNpc(
  from: NpcNode,
  pages: readonly Page[],
  hoppable: readonly string[],
  live?: readonly ShownAction[],
): Map<string, NpcReach> {
  const reach = new Map<string, NpcReach>();
  const start = npcKey(from);
  reach.set(start, { dist: 0 });
  const queue: NpcNode[] = [from];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]!;
    const here = reach.get(npcKey(current));
    if (!here) continue;
    const nexts = neighbors(current, {
      pages,
      hoppable,
      live,
      fromLive: npcKey(current) === start,
    });
    for (const { to, edge } of nexts) {
      const key = npcKey(to);
      if (reach.has(key)) continue;
      reach.set(key, { dist: here.dist + 1, first: here.first ?? edge });
      queue.push(to);
    }
  }
  return reach;
}

export function npcStepLive(ctx: BrainContext, edge: NpcEdge): boolean {
  if (edge.kind === "open") return (ctx.view.pages ?? []).includes(edge.page);
  return usableClicks(
    ctx.view.actions.filter((a) => a.id === edge.id),
    ctx,
  ).length > 0;
}

export function formatNpcStep(edge: NpcEdge): string {
  if (edge.kind === "open") return formatStep({ kind: "open", page: edge.page });
  return formatClick(edge.surface, { id: edge.id, ...(edge.nav ? { nav: true } : {}) });
}

export function pickWeighted<T>(items: readonly T[], scoreOf: (item: T) => number, rng: () => number): T | undefined {
  if (items.length === 0) return undefined;
  const ranked = [...items].sort((a, b) => scoreOf(b) - scoreOf(a));
  const weights = ranked.map((item) => Math.max(0, scoreOf(item)));
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return ranked[0];
  let ticket = rng() * total;
  for (let i = 0; i < ranked.length; i++) {
    ticket -= weights[i]!;
    if (ticket <= 0) return ranked[i];
  }
  return ranked[ranked.length - 1];
}

const DEFAULT_RETHINK = 0.15;

/** Among equal-hunger forms, randomize this often; otherwise fewer hops, then map order. */
export const HUNGRY_TIE_RANDOM = 0.1;
/**
 * After a fog reset every mapped form is hunger 1. Picking the closest then
 * sends every parallel walker to the same nearby form. Spread instead.
 */
export const HUNGRY_TIE_SPREAD = 3;

/** Hungriest goal. Many-way ties spread at random; 2-way ties prefer fewer hops. */
export function pickHungryGoal(
  goals: readonly NpcGoal[],
  distOf: (key: string) => number,
  rng: () => number,
): NpcGoal | undefined {
  if (goals.length === 0) return undefined;
  let max = -Infinity;
  for (const g of goals) {
    if (g.hunger > max) max = g.hunger;
  }
  const tied = goals.filter((g) => g.hunger === max);
  if (tied.length >= HUNGRY_TIE_SPREAD) {
    return tied[Math.floor(rng() * tied.length)]!;
  }
  if (tied.length > 1 && rng() >= 1 - HUNGRY_TIE_RANDOM) {
    return tied[Math.floor(rng() * tied.length)]!;
  }
  return [...tied].sort((a, b) => distOf(a.key) - distOf(b.key) || a.key.localeCompare(b.key))[0];
}

/** Pick a hungry reachable goal and the first live step toward it. */
export function planNpc(opts: {
  ctx: BrainContext;
  goals: readonly NpcGoal[];
  rng: () => number;
  committed?: string;
  rethink?: number;
  /** `hungry` = argmax hunger (form hunt). Default weights hunger × distance (map). */
  pick?: "weighted" | "hungry";
}): NpcPlan | undefined {
  const pages = opts.ctx.pages;
  if (!pages || pages.length === 0 || opts.goals.length === 0) return undefined;
  const from: NpcNode = { page: opts.ctx.view.page, surface: opts.ctx.view.surface };
  const here = npcKey(from);
  const hoppable = opts.ctx.view.pages ?? [];
  const flood = floodNpc(from, pages, hoppable, opts.ctx.view.actions);
  const reachable = opts.goals.filter((g) => {
    if (g.key === here) return false;
    const reach = flood.get(g.key);
    return Boolean(reach?.first && npcStepLive(opts.ctx, reach.first));
  });
  if (reachable.length === 0) return undefined;
  const distOf = (key: string) => flood.get(key)?.dist ?? 0;
  const scoreOf = (g: NpcGoal) => Math.max(0, g.hunger) * (1 + 1 / (1 + distOf(g.key)));
  let goal: NpcGoal | undefined;
  const rethink = opts.rethink ?? DEFAULT_RETHINK;
  const committed = opts.committed ? reachable.find((g) => g.key === opts.committed) : undefined;
  if (opts.pick === "hungry") {
    if (committed && opts.rng() > rethink) {
      const hungrier = reachable.some((g) => g.hunger > committed.hunger);
      if (!hungrier) goal = committed;
    }
    goal ??= pickHungryGoal(reachable, distOf, opts.rng);
  } else {
    // Stick to the hunt only when nothing reachable is hungrier (never-landed
    // rooms must beat a leftover target from last run's neighborhood).
    if (committed && opts.rng() > rethink) {
      const hungrier = reachable.some((g) => g.hunger > committed.hunger);
      if (!hungrier) goal = committed;
    }
    goal ??= pickWeighted(reachable, scoreOf, opts.rng);
  }
  if (!goal) return undefined;
  const reach = flood.get(goal.key);
  if (!reach?.first || !npcStepLive(opts.ctx, reach.first)) return undefined;
  return { goal: goal.key, dist: reach.dist, step: reach.first };
}
