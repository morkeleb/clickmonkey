import { formatStep } from "../schema/dsl.js";
import type { View } from "../schema/view.js";
import type { BrainContext, BrainDecision } from "./types.js";
import {
  decideForm,
  FORM_BURST_MAX,
  formatClick,
  formSubmitAction,
  hopPage,
  legalUnleashActions,
  isListChrome,
  LIST_CHROME_LIMIT,
  listChromeActions,
  listModeScore,
  listRowActions,
  pickAction,
  isEmptyStateAction,
  looksLikeSearchField,
  looksLikeRowSelectCheckbox,
  searchIsActive,
  stayActions,
  usableClicks,
  type FillFn,
} from "./unleash.js";
import { decideFormHunt, FORM_HUNT_STAY_RATE } from "./form-hunt.js";

export type WalkerModeName = "form" | "list" | "nav";

export interface WalkerMode {
  name: WalkerModeName;
  detect(ctx: BrainContext): boolean;
  decide(
    ctx: BrainContext,
    rng: () => number,
    fill: FillFn,
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
    formSubmitAction(legal, view.surface, view) ?? formSubmitAction(view.actions, view.surface, view),
  );
}

function fillEmptyBurst(view: View, fill: FillFn): BrainDecision | undefined {
  const empty = view.shown.filter(
    (f) =>
      !looksLikeSearchField(f) &&
      !looksLikeRowSelectCheckbox(f) &&
      (!f.value.trim() || f.value === "••••"),
  );
  if (empty.length === 0) return undefined;
  const toFill = empty.slice(0, FORM_BURST_MAX);
  const lines = toFill.map((field) =>
    formatStep({
      kind: "fill",
      surface: view.surface,
      id: field.id,
      value: fill(field),
    }),
  );
  return { line: lines[0]!, lines, note: "form" };
}

function hopOrChromeFallback(view: View, rng: () => number, ctx?: BrainContext): BrainDecision {
  const hunt = ctx ? decideFormHunt(ctx, rng) : undefined;
  if (hunt) return hunt;
  const hop = hopPage(view, rng);
  if (!hop.line.startsWith("screenshot") || view.actions.length === 0) return hop;
  const actions = searchIsActive(view)
    ? view.actions.filter((a) => !isEmptyStateAction(a))
    : view.actions;
  const pool = usableClicks(actions, ctx);
  if (pool.length === 0) return hop;
  return { line: formatClick(view.surface, pickAction(pool, rng, "nav")) };
}

function huntOrLocal(
  ctx: BrainContext,
  rng: () => number,
  local: () => BrainDecision,
): BrainDecision {
  const hunt = decideFormHunt(ctx, rng);
  if (hunt && rng() >= FORM_HUNT_STAY_RATE) return hunt;
  return local();
}

function decideNav(ctx: BrainContext, rng: () => number, fill: FillFn): BrainDecision {
  const { view } = ctx;
  const legal = legalUnleashActions(view, ctx.pages);
  const stay = stayActions(view, ctx.pages);
  const fields = view.shown;

  if (legal.length === 0 && fields.length === 0) return hopOrChromeFallback(view, rng, ctx);

  const leftover = fillEmptyBurst(view, fill);
  if (leftover) return leftover;

  return huntOrLocal(ctx, rng, () => {
    const stayFresh = usableClicks(stay, ctx);
    const legalFresh = usableClicks(legal, ctx);
    const pool = stayFresh.length > 0 ? stayFresh : legalFresh;
    if (pool.length > 0) {
      return { line: formatClick(view.surface, pick(pool, rng)) };
    }
    return hopOrChromeFallback(view, rng, ctx);
  });
}

function decideFormMode(ctx: BrainContext, rng: () => number, fill: FillFn): BrainDecision {
  const { view } = ctx;
  const legal = legalUnleashActions(view, ctx.pages);
  const commit = ctx.writePolicy === "allow" || view.stack.length > 1;
  if (commit) {
    const form = decideForm(view, legal, rng, fill, ctx);
    if (form) return form;
    return hopOrChromeFallback(view, rng, ctx);
  }
  return fillEmptyBurst(view, fill) ?? decideNav(ctx, rng, fill);
}

function decideList(ctx: BrainContext, rng: () => number, fill: FillFn): BrainDecision {
  const { view } = ctx;
  const leftover = fillEmptyBurst(view, fill);
  if (leftover) return { ...leftover, note: "list" };

  return huntOrLocal(ctx, rng, () => decideListLocal(ctx, rng));
}

function decideListLocal(ctx: BrainContext, rng: () => number): BrainDecision {
  const { view } = ctx;
  const stay = stayActions(view, ctx.pages);
  const chrome = usableClicks(listChromeActions(stay), ctx, LIST_CHROME_LIMIT);
  if (chrome.length > 0) {
    return { line: formatClick(view.surface, pick(chrome, rng)), note: "list chrome" };
  }

  const rows = usableClicks(listRowActions(view, ctx.pages), ctx);
  if (rows.length > 0) {
    return { line: formatClick(view.surface, pick(rows, rng)), note: "list row" };
  }

  const other = usableClicks(
    stay.filter((a) => !isListChrome(a)),
    ctx,
  );
  if (other.length > 0) {
    return { line: formatClick(view.surface, pick(other, rng)), note: "list stay" };
  }

  const legal = usableClicks(
    legalUnleashActions(view, ctx.pages).filter((a) => !isListChrome(a)),
    ctx,
  );
  if (legal.length > 0) {
    return { line: formatClick(view.surface, pick(legal, rng)), note: "list stay" };
  }

  return hopOrChromeFallback(view, rng, ctx);
}

const formMode: WalkerMode = {
  name: "form",
  detect: (ctx) => ctx.view.shown.length > 0 && hasSurfaceSubmit(ctx),
  decide: decideFormMode,
};

const listMode: WalkerMode = {
  name: "list",
  detect: (ctx) => !hasSurfaceSubmit(ctx) && listModeScore(ctx.view, ctx.pages) >= 2,
  decide: decideList,
};

const navMode: WalkerMode = {
  name: "nav",
  detect: () => true,
  decide: decideNav,
};

/** Ordered detectors: first match owns legal moves. Not a Markov chain. */
export const UNLEASH_MODES: WalkerMode[] = [formMode, listMode, navMode];

export function detectWalkerMode(ctx: BrainContext): WalkerMode {
  return UNLEASH_MODES.find((m) => m.detect(ctx)) ?? navMode;
}
