import { formatStep } from "../schema/dsl.js";
import type { Action, Page, Surface } from "../schema/page-model.js";
import type { ShownAction, View } from "../schema/view.js";
import type { BrainContext, BrainDecision } from "./types.js";
import { formatClick, formSubmitAction, looksLikeSearchField, usableClicks } from "./unleash.js";

/** Chance to stay on local chrome instead of walking toward a map form. */
export const FORM_HUNT_STAY_RATE = 0.2;
/** Chance to drop the current hunt target and pick again. */
export const FORM_HUNT_RETHINK = 0.15;

export type FormGoal = {
  pageId: string;
  surfaceId: string;
  fields: number;
};

export type HuntNode = { page: string; surface: string };

export type HuntEdge =
  | { kind: "open"; page: string }
  | { kind: "click"; surface: string; id: string; nav?: boolean };

export type HuntReach = {
  dist: number;
  first?: HuntEdge;
};

export function formGoalKey(goal: { pageId: string; surfaceId: string }): string {
  return `${goal.pageId}/${goal.surfaceId}`;
}

export function huntNodeKey(node: HuntNode): string {
  return `${node.page}/${node.surface}`;
}

export function pageSurfaceId(page: Page): string {
  return page.surfaces.find((s) => s.kind === "page")?.id ?? page.id;
}

function okAction(action: Action): boolean {
  return (action.status ?? "ok") === "ok";
}

function okField(field: { status?: string }): boolean {
  return (field.status ?? "ok") === "ok";
}

/** Non-search fields plus a submit-like action — a form the walker should exercise. */
export function isMapFormSurface(surface: Surface): boolean {
  const fields = surface.fields.filter(
    (f) =>
      okField(f) &&
      !looksLikeSearchField({ id: f.id, value: "", type: f.type, ...(f.name ? { label: f.name } : {}) }),
  );
  if (fields.length === 0) return false;
  const actions = surface.actions.filter(okAction).map((a) => ({
    id: a.id,
    ...(a.opens ? { opens: a.opens } : {}),
  }));
  return Boolean(formSubmitAction(actions, surface.id));
}

export function mapFormGoals(pages: readonly Page[]): FormGoal[] {
  const goals: FormGoal[] = [];
  for (const page of pages) {
    for (const surface of page.surfaces) {
      if (!isMapFormSurface(surface)) continue;
      const fields = surface.fields.filter(
        (f) =>
          okField(f) &&
          !looksLikeSearchField({ id: f.id, value: "", type: f.type, ...(f.name ? { label: f.name } : {}) }),
      );
      goals.push({ pageId: page.id, surfaceId: surface.id, fields: fields.length });
    }
  }
  return goals;
}

function pageById(pages: readonly Page[], id: string): Page | undefined {
  return pages.find((p) => p.id === id);
}

function clickEdge(surface: string, action: { id: string; nav?: boolean }): HuntEdge {
  return { kind: "click", surface, id: action.id, ...(action.nav ? { nav: true } : {}) };
}

function neighbors(
  node: HuntNode,
  opts: {
    pages: readonly Page[];
    hoppable: readonly string[];
    live?: readonly ShownAction[];
    fromLive: boolean;
  },
): Array<{ to: HuntNode; edge: HuntEdge }> {
  const out: Array<{ to: HuntNode; edge: HuntEdge }> = [];
  const seen = new Set<string>();
  const push = (to: HuntNode, edge: HuntEdge) => {
    const key = `${huntNodeKey(to)}\0${edge.kind}:${edge.kind === "open" ? edge.page : edge.id}`;
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
export function floodHunt(
  from: HuntNode,
  pages: readonly Page[],
  hoppable: readonly string[],
  live?: readonly ShownAction[],
): Map<string, HuntReach> {
  const reach = new Map<string, HuntReach>();
  const start = huntNodeKey(from);
  reach.set(start, { dist: 0 });
  const queue: HuntNode[] = [from];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]!;
    const here = reach.get(huntNodeKey(current));
    if (!here) continue;
    const nexts = neighbors(current, {
      pages,
      hoppable,
      live,
      fromLive: huntNodeKey(current) === start,
    });
    for (const { to, edge } of nexts) {
      const key = huntNodeKey(to);
      if (reach.has(key)) continue;
      reach.set(key, { dist: here.dist + 1, first: here.first ?? edge });
      queue.push(to);
    }
  }
  return reach;
}

export function huntHunger(hits: number): number {
  return 1 / (1 + Math.max(0, hits));
}

export function huntScore(hits: number, dist: number): number {
  return huntHunger(hits) * (1 + 1 / (1 + Math.max(0, dist)));
}

function pickWeighted<T>(items: readonly T[], scoreOf: (item: T) => number, rng: () => number): T | undefined {
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

function liveAllows(ctx: BrainContext, edge: HuntEdge): boolean {
  const { view } = ctx;
  if (edge.kind === "open") return (view.pages ?? []).includes(edge.page);
  const match = view.actions.filter((a) => a.id === edge.id);
  return usableClicks(match, ctx).length > 0;
}

function lineFor(edge: HuntEdge): string {
  if (edge.kind === "open") return formatStep({ kind: "open", page: edge.page });
  return formatClick(edge.surface, { id: edge.id, ...(edge.nav ? { nav: true } : {}) });
}

/**
 * Next step toward an under-tested map form. Undefined when already on one,
 * or the sitemap has no reachable form.
 */
export function decideFormHunt(ctx: BrainContext, rng: () => number): BrainDecision | undefined {
  const pages = ctx.pages;
  if (!pages || pages.length === 0) return undefined;
  const goals = mapFormGoals(pages);
  if (goals.length === 0) return undefined;

  const from: HuntNode = { page: ctx.view.page, surface: ctx.view.surface };
  const here = huntNodeKey(from);
  if (goals.some((g) => formGoalKey(g) === here)) return undefined;

  const hoppable = ctx.view.pages ?? [];
  const flood = floodHunt(from, pages, hoppable, ctx.view.actions);
  const reachable = goals.filter((g) => {
    const reach = flood.get(formGoalKey(g));
    return Boolean(reach?.first && liveAllows(ctx, reach.first));
  });
  if (reachable.length === 0) return undefined;

  const hitsOf = (g: FormGoal) => ctx.formHits?.[formGoalKey(g)] ?? 0;
  const scoreOf = (g: FormGoal) => huntScore(hitsOf(g), flood.get(formGoalKey(g))?.dist ?? 0);

  let goal: FormGoal | undefined;
  const committed = ctx.huntTarget
    ? reachable.find((g) => formGoalKey(g) === ctx.huntTarget)
    : undefined;
  if (committed && rng() > FORM_HUNT_RETHINK) goal = committed;
  goal ??= pickWeighted(reachable, scoreOf, rng);
  if (!goal) return undefined;

  const step = flood.get(formGoalKey(goal))?.first;
  if (!step || !liveAllows(ctx, step)) return undefined;
  return {
    line: lineFor(step),
    note: "form hunt",
    huntTarget: formGoalKey(goal),
  };
}
