import type { Page, Surface } from "../schema/page-model.js";
import type { BrainContext, BrainDecision } from "./types.js";
import {
  formSubmitAction,
  isAuthGatePage,
  isPrimaryFormCommit,
  looksLikeMidForm,
  looksLikeSearchField,
  looksLikeUnfinishedForm,
} from "./unleash.js";
import { FOG_OLD_MS, fogHunger, formatNpcStep, npcHunger, npcKey, planNpc, staleMsForPage } from "./npc.js";

export { floodNpc as floodHunt, npcHunger as huntHunger, npcKey as huntNodeKey, npcScore as huntScore, pageSurfaceId } from "./npc.js";
export type { NpcEdge as HuntEdge, NpcNode as HuntNode, NpcReach as HuntReach } from "./npc.js";

/** Chance to stay on local chrome instead of walking toward a map form. */
export const FORM_HUNT_STAY_RATE = 0.2;
/**
 * Mix job-land into form hunger so a never-visited page beats a form this
 * job already stood on (and parallel walkers spread after one lands).
 * Form-work is still the primary clock — a land is not a fill.
 */
export const FORM_LAND_SPREAD = 0.5;
/** Chance to drop the current hunt target when nothing is hungrier. */
export const FORM_HUNT_RETHINK = 0.15;
/** Standing on the list is not a fill — keep that page's unfilled form on top of a many-way tie. */
const HERE_FORM = 1.05;
/** Local clicks after a submit that landed on a new page (inspect the record). */
export const LOOT_EXPLORE_STEPS = 5;

export type FormGoal = {
  pageId: string;
  surfaceId: string;
  fields: number;
};

export function formGoalKey(goal: { pageId: string; surfaceId: string }): string {
  return `${goal.pageId}/${goal.surfaceId}`;
}

/** `--form clients_new` or `--form clients_new/page`. */
export function parseFormLock(raw: string): { pageId: string; surfaceId: string } {
  const trimmed = raw.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0) return { pageId: trimmed, surfaceId: "page" };
  return { pageId: trimmed.slice(0, slash), surfaceId: trimmed.slice(slash + 1) || "page" };
}

export function isOnFormLock(ctx: Pick<BrainContext, "view" | "lockForm">): boolean {
  return Boolean(ctx.lockForm && ctx.view.page === ctx.lockForm);
}

function okAction(action: { status?: string }): boolean {
  return (action.status ?? "ok") === "ok";
}

function okField(field: { status?: string }): boolean {
  return (field.status ?? "ok") === "ok";
}

/** Non-search fields plus a submit-like action — a form the walker should exercise. */
export function isMapFormSurface(surface: Surface, page?: Page): boolean {
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
  if (formSubmitAction(actions, surface.id)) return true;
  // Save/Create that hops to a record page still counts; a dialog opener does not.
  return actions.some((a) => isPrimaryFormCommit(a, page, surface.id));
}

export function mapFormGoals(pages: readonly Page[]): FormGoal[] {
  const goals: FormGoal[] = [];
  for (const page of pages) {
    for (const surface of page.surfaces) {
      if (!isMapFormSurface(surface, page)) continue;
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

/** Form-work hunger, eased by whether this job has already stood on the page. */
export function formHuntHunger(
  ctx: Pick<BrainContext, "formHits" | "formWork" | "pageFog" | "view">,
  g: FormGoal,
): number {
  const work = npcHunger(ctx.formHits?.[formGoalKey(g)] ?? 0, staleMsForPage(ctx.formWork, formGoalKey(g)));
  const onHost = ctx.view?.page === g.pageId;
  const land = fogHunger(onHost ? FOG_OLD_MS : staleMsForPage(ctx.pageFog, g.pageId));
  const mix = work * (FORM_LAND_SPREAD + (1 - FORM_LAND_SPREAD) * land);
  return onHost ? mix * HERE_FORM : mix;
}

/** Next step toward an under-tested map form. Undefined when already on one. */
export function decideFormHunt(ctx: BrainContext, rng: () => number): BrainDecision | undefined {
  const pages = ctx.pages;
  if (!pages || pages.length === 0) return undefined;
  if (isAuthGatePage(ctx.view.page, pages)) return undefined;
  if (ctx.lockForm && isOnFormLock(ctx)) return undefined;
  const mapped = mapFormGoals(pages);
  const forms = ctx.lockForm
    ? mapped.filter((g) => g.pageId === ctx.lockForm)
    : mapped;
  const locked =
    ctx.lockForm && forms.length === 0
      ? [{ pageId: ctx.lockForm, surfaceId: "page", fields: 1 }]
      : forms;
  if (locked.length === 0) return undefined;
  const here = npcKey({ page: ctx.view.page, surface: ctx.view.surface });
  const hereSpent = Boolean(ctx.formSpent?.[here]);
  if (!ctx.lockForm && !hereSpent && (looksLikeUnfinishedForm(ctx.view) || looksLikeMidForm(ctx.view))) {
    return undefined;
  }
  if (locked.some((g) => formGoalKey(g) === here) && !hereSpent) return undefined;
  const plan = planNpc({
    ctx,
    goals: locked.map((g) => ({
      key: formGoalKey(g),
      hunger: formHuntHunger(ctx, g),
    })),
    rng,
    committed: ctx.lockForm ? formGoalKey(locked[0]!) : ctx.huntTarget,
    rethink: ctx.lockForm ? 0 : FORM_HUNT_RETHINK,
    pick: "hungry",
  });
  if (!plan) return undefined;
  return {
    line: formatNpcStep(plan.step),
    note: "form hunt",
    huntTarget: plan.goal,
  };
}
