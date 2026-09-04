import { hopContextOf, hoppablePages } from "../executor/hop.js";
import { createExecutor, type RunState } from "../executor/run.js";
import type { View } from "../schema/view.js";
import { needsLeashReentry } from "../brains/unleash.js";
import { liveHref, reenterLeash, viewOfState } from "./leash.js";

export { viewOfState } from "./leash.js";

/** Prefer the page we landed on after intro, but never an entry / fenced / empty page. */
export function pickSeedPageId(state: RunState, preferred: string): string | undefined {
  const hoppable = hoppablePages(state.model.pages, hopContextOf(state));
  if (hoppable.some((p) => p.id === preferred)) return preferred;
  return hoppable[0]?.id;
}

export async function resetToSeed(
  exec: ReturnType<typeof createExecutor>,
  state: RunState,
  seedPageId: string,
): Promise<View> {
  if (
    !state.inIntro &&
    state.config.intro.length > 0 &&
    needsLeashReentry(state.pageId, liveHref(state), state.model.pages)
  ) {
    try {
      await reenterLeash(exec, state);
    } catch {
      // Still on the gate — do not `open` seed from login.
    }
    return viewOfState(state);
  }
  const id = pickSeedPageId(state, seedPageId);
  if (id) {
    const reset = await exec.runLine(`open ${id}`);
    return reset.view;
  }
  return viewOfState(state);
}
