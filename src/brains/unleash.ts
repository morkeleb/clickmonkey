import { formatStep } from "../schema/dsl.js";
import type { ShownAction, ShownField, View } from "../schema/view.js";
import type { Brain, BrainContext, BrainDecision } from "./types.js";

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)]!;
}

/** Map leans on chrome; unleash leans on the page body. */
export const LANDMARK_BIAS = 0.75;

export function pickAction(
  actions: readonly ShownAction[],
  rng: () => number,
  prefer: "nav" | "main",
): ShownAction {
  const preferred =
    prefer === "nav" ? actions.filter((a) => a.nav) : actions.filter((a) => !a.nav);
  const pool = preferred.length > 0 && rng() < LANDMARK_BIAS ? preferred : actions;
  return pick(pool, rng);
}

export function formatClick(surface: string, action: ShownAction): string {
  return formatStep({
    kind: "click",
    surface,
    id: action.id,
    ...(action.nav ? { nav: true } : {}),
  });
}

const WRITE_ID =
  /^(submit|save|delete|remove|destroy|confirm|send|update|apply|publish|add_to_cart|add_to_bag)$/i;
const WRITE_LABEL =
  /\b(submit|save|delete|remove|destroy|confirm|send|update|apply|publish|add to (?:cart|bag))\b/i;
const LEAVE_ID =
  /(^|_)(sign_out|signout|log_out|logout|log_off|sign_off|close_panel|close_all_tabs|collapse_menu)$|(^|_)close_[a-z0-9]/i;
const LEAVE_LABEL = /\b(sign out|log out|logout|sign off|close panel)\b|^close\b/i;

export function matchesSkip(
  widget: { id: string; label?: string },
  skip: readonly string[] | undefined,
): boolean {
  if (!skip || skip.length === 0) return false;
  const id = widget.id.toLowerCase();
  const label = (widget.label ?? "").toLowerCase();
  return skip.some((raw) => {
    const s = raw.toLowerCase().trim();
    if (!s) return false;
    const snake = s.replace(/\s+/g, "_");
    return id.includes(snake) || label.includes(s);
  });
}

export function isLeaveAction(action: { id: string; label?: string; opens?: string }): boolean {
  if (action.opens) return false;
  if (LEAVE_ID.test(action.id)) return true;
  if (action.label && LEAVE_LABEL.test(action.label)) return true;
  return false;
}

/** Dialog openers (`opens`) are navigation even when the id looks like a write. */
export function isWriteAction(action: ShownAction): boolean {
  if (action.opens) return false;
  if (isLeaveAction(action)) return true;
  if (WRITE_ID.test(action.id)) return true;
  if (action.label && WRITE_LABEL.test(action.label)) return true;
  return false;
}

export function navigateActions(view: View, skip?: readonly string[]): ShownAction[] {
  return view.actions.filter((a) => !isWriteAction(a) && !matchesSkip(a, skip));
}

export function hopPage(view: View, rng: () => number): BrainDecision {
  const pages = view.pages ?? [];
  const others = pages.filter((id) => id !== view.page);
  const justHopped = Boolean(view.last?.step.startsWith("open "));
  if (justHopped) {
    return { line: formatStep({ kind: "screenshot" }), note: "no legal widgets after hop" };
  }
  if (others.length > 0) {
    return { line: formatStep({ kind: "open", page: pick(others, rng) }), note: "hop" };
  }
  if (pages.includes(view.page)) {
    return { line: formatStep({ kind: "open", page: view.page }), note: "no legal widgets" };
  }
  return { line: formatStep({ kind: "screenshot" }), note: "no hoppable pages" };
}

/** Short, non-nasty fill. Empty is always legal and keeps writePolicy walking. */
export function plausibleFill(type: ShownField["type"], rng: () => number = Math.random): string {
  if (rng() < 0.5) return "";
  switch (type) {
    case "number":
      return "1";
    case "email":
      return "user@example.com";
    default:
      return "x";
  }
}

export function decideUnleash(ctx: BrainContext, rng: () => number = Math.random): BrainDecision {
  const { view } = ctx;
  const actions = view.actions;
  const fields = view.shown;
  const surface = view.surface;

  if (actions.length === 0 && fields.length === 0) return hopPage(view, rng);

  // 50% click, 30% fill, 20% click when we only have (or still have) actions.
  const roll = rng();
  const wantFill = fields.length > 0 && roll >= 0.5 && roll < 0.8;
  if (wantFill || actions.length === 0) {
    const field = pick(fields, rng);
    return {
      line: formatStep({
        kind: "fill",
        surface,
        id: field.id,
        value: plausibleFill(field.type, rng),
      }),
    };
  }

  const action = pickAction(actions, rng, "main");
  return { line: formatClick(surface, action) };
}

/** Click links and other non-write actions. Never fill. Hop to a known page when stuck. */
export function decideMap(ctx: BrainContext, rng: () => number = Math.random): BrainDecision {
  const { view } = ctx;
  const nav = navigateActions(view);
  if (nav.length === 0) return hopPage(view, rng);
  const action = pickAction(nav, rng, "nav");
  return { line: formatClick(view.surface, action) };
}

export const unleashBrain: Brain = {
  name: "unleash",
  decide: (ctx) => decideUnleash(ctx),
};

export const mapBrain: Brain = {
  name: "map",
  decide: (ctx) => decideMap(ctx),
};
