import { formatStep } from "../schema/dsl.js";
import type { ShownField } from "../schema/view.js";
import type { Brain, BrainContext, BrainDecision } from "./types.js";

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)]!;
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

  if (actions.length === 0 && fields.length === 0) {
    return { line: formatStep({ kind: "open", page: view.page }), note: "no legal widgets" };
  }

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

  const action = pick(actions, rng);
  return { line: formatStep({ kind: "click", surface, id: action.id }) };
}

export const unleashBrain: Brain = {
  name: "unleash",
  decide: (ctx) => decideUnleash(ctx),
};
