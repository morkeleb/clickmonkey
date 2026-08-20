import { formatStep } from "../schema/dsl.js";
import type { ShownField, View } from "../schema/view.js";
import type { BrainContext, BrainDecision } from "./types.js";
import {
  decideForm,
  FORM_BURST_MAX,
  formatClick,
  formSubmitAction,
  freshClicks,
  hopPage,
  legalUnleashActions,
  pickAction,
  stayActions,
} from "./unleash.js";

export type WalkerModeName = "form" | "nav";

export interface WalkerMode {
  name: WalkerModeName;
  detect(ctx: BrainContext): boolean;
  decide(
    ctx: BrainContext,
    rng: () => number,
    fill: (type: ShownField["type"]) => string,
  ): BrainDecision;
}

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)]!;
}

/** Submit on this surface, including self-`opens`. writePolicy/dialog do not gate detect. */
function hasSurfaceSubmit(ctx: BrainContext): boolean {
  const { view } = ctx;
  const legal = legalUnleashActions(view, ctx.pages);
  return Boolean(
    formSubmitAction(legal, view.surface) ?? formSubmitAction(view.actions, view.surface),
  );
}

function fillEmptyBurst(
  view: View,
  fill: (type: ShownField["type"]) => string,
): BrainDecision | undefined {
  const empty = view.shown.filter((f) => !f.value.trim() || f.value === "••••");
  if (empty.length === 0) return undefined;
  const toFill = empty.slice(0, FORM_BURST_MAX);
  const lines = toFill.map((field) =>
    formatStep({
      kind: "fill",
      surface: view.surface,
      id: field.id,
      value: fill(field.type),
    }),
  );
  return { line: lines[0]!, lines, note: "form" };
}

function hopOrChromeFallback(view: View, rng: () => number): BrainDecision {
  const hop = hopPage(view, rng);
  if (!hop.line.startsWith("screenshot") || view.actions.length === 0) return hop;
  return { line: formatClick(view.surface, pickAction(view.actions, rng, "nav")) };
}

function decideNav(
  ctx: BrainContext,
  rng: () => number,
  fill: (type: ShownField["type"]) => string,
): BrainDecision {
  const { view } = ctx;
  const legal = legalUnleashActions(view, ctx.pages);
  const stay = stayActions(view, ctx.pages);
  const fields = view.shown;

  if (legal.length === 0 && fields.length === 0) return hopOrChromeFallback(view, rng);

  const leftover = fillEmptyBurst(view, fill);
  if (leftover) return leftover;

  const recent = ctx.recentClicks ?? [];
  const stayFresh = freshClicks(stay, recent);
  const legalFresh = freshClicks(legal, recent);
  const pool = stayFresh.length > 0 ? stayFresh : legalFresh;
  if (pool.length > 0) {
    return { line: formatClick(view.surface, pick(pool, rng)) };
  }
  return hopOrChromeFallback(view, rng);
}

function decideFormMode(
  ctx: BrainContext,
  rng: () => number,
  fill: (type: ShownField["type"]) => string,
): BrainDecision {
  const { view } = ctx;
  const legal = legalUnleashActions(view, ctx.pages);
  const commit = ctx.writePolicy === "allow" || view.stack.length > 1;
  if (commit) {
    const form = decideForm(view, legal, rng, fill);
    if (form) return form;
  }
  return fillEmptyBurst(view, fill) ?? decideNav(ctx, rng, fill);
}

const formMode: WalkerMode = {
  name: "form",
  detect: (ctx) => ctx.view.shown.length > 0 && hasSurfaceSubmit(ctx),
  decide: decideFormMode,
};

const navMode: WalkerMode = {
  name: "nav",
  detect: () => true,
  decide: decideNav,
};

/** Ordered detectors: first match owns legal moves. Not a Markov chain. */
export const UNLEASH_MODES: WalkerMode[] = [formMode, navMode];

export function detectWalkerMode(ctx: BrainContext): WalkerMode {
  return UNLEASH_MODES.find((m) => m.detect(ctx)) ?? navMode;
}
