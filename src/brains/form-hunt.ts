import type { Page, Surface } from "../schema/page-model.js";
import type { BrainContext, BrainDecision } from "./types.js";
import { formSubmitAction, looksLikeSearchField } from "./unleash.js";
import { formatNpcStep, npcHunger, npcKey, planNpc, staleMsForPage } from "./npc.js";

export { floodNpc as floodHunt, npcHunger as huntHunger, npcKey as huntNodeKey, npcScore as huntScore, pageSurfaceId } from "./npc.js";
export type { NpcEdge as HuntEdge, NpcNode as HuntNode, NpcReach as HuntReach } from "./npc.js";

/** Chance to stay on local chrome instead of walking toward a map form. */
export const FORM_HUNT_STAY_RATE = 0.2;
/** Chance to drop the current hunt target and pick again. */
export const FORM_HUNT_RETHINK = 0.15;
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

/** Next step toward an under-tested map form. Undefined when already on one. */
export function decideFormHunt(ctx: BrainContext, rng: () => number): BrainDecision | undefined {
  const pages = ctx.pages;
  if (!pages || pages.length === 0) return undefined;
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
  if (locked.some((g) => formGoalKey(g) === here)) return undefined;
  const plan = planNpc({
    ctx,
    goals: locked.map((g) => ({
      key: formGoalKey(g),
      hunger: npcHunger(ctx.formHits?.[formGoalKey(g)] ?? 0, staleMsForPage(ctx.pageFog, g.pageId)),
    })),
    rng,
    committed: ctx.lockForm ? formGoalKey(locked[0]!) : ctx.huntTarget,
    rethink: ctx.lockForm ? 0 : FORM_HUNT_RETHINK,
  });
  if (!plan) return undefined;
  return {
    line: formatNpcStep(plan.step),
    note: "form hunt",
    huntTarget: plan.goal,
  };
}
