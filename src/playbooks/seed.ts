import { hopContextOf, hoppablePages } from "../executor/hop.js";
import { createExecutor, type RunState } from "../executor/run.js";
import { buildView } from "../executor/view.js";
import type { View } from "../schema/view.js";

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
  const id = pickSeedPageId(state, seedPageId);
  if (id) {
    const reset = await exec.runLine(`open ${id}`);
    return reset.view;
  }
  return buildView({
    page: state.page,
    pageId: state.pageId,
    surfaceStack: state.surfaceStack.length > 0 ? state.surfaceStack : [state.pageId],
    model: state.model,
    appUrl: state.config.url,
    fence: state.config.fence,
    intro: state.config.intro,
    skip: state.config.skip,
    inIntro: Boolean(state.inIntro),
    ...(state.configPath ? { configPath: state.configPath } : {}),
  });
}
