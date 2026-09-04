import type { Page } from "../schema/page-model.js";
import type { ShownAction } from "../schema/view.js";
import type { BrainContext, BrainDecision } from "./types.js";
import { formatNpcStep, npcHunger, npcKey, pageSurfaceId, planNpc, staleMsForPage } from "./npc.js";
import { formatClick, navigateActions, pickAction, usableClicks } from "./unleash.js";

export function visitKey(pageId: string, surfaceId: string): string {
  return npcKey({ page: pageId, surface: surfaceId });
}

function visitsOf(visits: Readonly<Record<string, number>> | undefined, key: string): number {
  return visits?.[key] ?? 0;
}

function destVisitKey(
  action: ShownAction,
  pageId: string,
  pages: readonly Page[] | undefined,
): string | undefined {
  if (!action.opens) return undefined;
  const destPage = pages?.find((p) => p.id === action.opens);
  if (destPage) return visitKey(destPage.id, pageSurfaceId(destPage));
  if (pages?.some((p) => p.id === pageId && p.surfaces.some((s) => s.id === action.opens))) {
    return visitKey(pageId, action.opens);
  }
  return visitKey(action.opens, "page");
}

/**
 * Local door that still grows the map: no `opens` yet, or a hop to a page
 * this job has never landed (missing `pageFog`). A room this job stood on
 * last run is not unseen — hunger pathfinds to never-landed rooms instead.
 */
export function fogClicks(ctx: BrainContext): ShownAction[] {
  const nav = usableClicks(navigateActions(ctx.view), ctx);
  const fog: ShownAction[] = [];
  for (const action of nav) {
    if (!action.opens) {
      fog.push(action);
      continue;
    }
    const dest = destVisitKey(action, ctx.view.page, ctx.pages);
    if (!dest) {
      fog.push(action);
      continue;
    }
    if (visitsOf(ctx.pageVisits, dest) > 0) continue;
    const destPage = dest.split("/")[0] ?? dest;
    if (ctx.pageFog?.[destPage]) continue;
    fog.push(action);
  }
  return fog;
}

function mapRoomGoals(ctx: BrainContext): { key: string; hunger: number }[] {
  const pages = ctx.pages ?? [];
  const hoppable = new Set(ctx.view.pages ?? []);
  const goals: { key: string; hunger: number }[] = [];
  const seen = new Set<string>();
  const add = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    const pageId = key.split("/")[0] ?? key;
    goals.push({
      key,
      hunger: npcHunger(visitsOf(ctx.pageVisits, key), staleMsForPage(ctx.pageFog, pageId)),
    });
  };
  for (const page of pages) {
    if (!hoppable.has(page.id) && page.id !== ctx.view.page) continue;
    add(visitKey(page.id, pageSurfaceId(page)));
    for (const surface of page.surfaces) {
      if (surface.kind === "dialog") add(visitKey(page.id, surface.id));
    }
  }
  for (const id of hoppable) {
    const page = pages.find((p) => p.id === id);
    add(visitKey(id, page ? pageSurfaceId(page) : "page"));
  }
  return goals;
}

/**
 * Lift fog: click an unseen door here, else the shared NPC planner walks
 * toward an unvisited map room.
 */
export function decideMapScout(ctx: BrainContext, rng: () => number): BrainDecision | undefined {
  const local = fogClicks(ctx);
  if (local.length > 0) {
    const opened = local.filter((a) => a.opens);
    const pool = opened.length > 0 ? opened : local;
    const prefer = pool.some((a) => a.nav) ? "nav" : "main";
    const action = pickAction(pool, rng, prefer);
    return {
      line: formatClick(ctx.view.surface, action),
      note: "map scout",
    };
  }
  const plan = planNpc({ ctx, goals: mapRoomGoals(ctx), rng, committed: ctx.huntTarget });
  if (!plan) return undefined;
  return { line: formatNpcStep(plan.step), note: "map scout", huntTarget: plan.goal };
}
