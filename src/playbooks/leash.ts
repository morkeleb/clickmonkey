import { needsLeashReentry } from "../brains/unleash.js";
import type { createExecutor, RunState } from "../executor/run.js";
import { buildView } from "../executor/view.js";
import type { View } from "../schema/view.js";

export const LEASH_REENTRY_TRIES = 3;

export function liveHref(state: Pick<RunState, "page">): string | undefined {
  try {
    return state.page?.url();
  } catch {
    return undefined;
  }
}

export function viewOfState(state: RunState): Promise<View> {
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

/** `goto` the leash url, then intro when still on the auth gate. */
export async function reenterLeash(
  exec: Pick<ReturnType<typeof createExecutor>, "runIntro">,
  state: RunState,
): Promise<"intro" | "already-in"> {
  await state.page.goto(state.config.url, { waitUntil: "domcontentloaded" });
  await state.afterStep?.(state);
  const href = liveHref(state);
  if (
    state.config.intro.length > 0 &&
    needsLeashReentry(state.pageId, href, state.model.pages)
  ) {
    await exec.runIntro();
    return "intro";
  }
  return "already-in";
}

export type LeashReentryBudget = { tries: number };

export type LeashRecoverResult = {
  recovered: boolean;
  gaveUp: boolean;
  attempted: boolean;
};

/**
 * If the walker is on login/logout, `goto` config.url and run intro.
 * Does not consume walk steps. Stops after {@link LEASH_REENTRY_TRIES}.
 */
export async function recoverLeashIfNeeded(opts: {
  pageId: string;
  href?: string;
  pages?: RunState["model"]["pages"];
  exec: Pick<ReturnType<typeof createExecutor>, "runIntro">;
  state: RunState;
  budget: LeashReentryBudget;
  echo?: (line: string) => void;
}): Promise<LeashRecoverResult> {
  if (opts.state.inIntro) return { recovered: false, gaveUp: false, attempted: false };
  if (opts.state.config.intro.length === 0) {
    return { recovered: false, gaveUp: false, attempted: false };
  }
  if (!needsLeashReentry(opts.pageId, opts.href, opts.pages)) {
    return { recovered: false, gaveUp: false, attempted: false };
  }
  if (opts.budget.tries >= LEASH_REENTRY_TRIES) {
    opts.echo?.(`leash re-entry gave up after ${LEASH_REENTRY_TRIES} tries`);
    return { recovered: false, gaveUp: true, attempted: false };
  }
  opts.budget.tries += 1;
  opts.echo?.(
    `leash re-entry ${opts.budget.tries}/${LEASH_REENTRY_TRIES}: logged out on ${opts.pageId}; goto leash then intro`,
  );
  try {
    await reenterLeash(opts.exec, opts.state);
    if (needsLeashReentry(opts.state.pageId, liveHref(opts.state), opts.pages)) {
      opts.echo?.("leash re-entry still on the auth gate");
      return {
        recovered: false,
        gaveUp: opts.budget.tries >= LEASH_REENTRY_TRIES,
        attempted: true,
      };
    }
    opts.budget.tries = 0;
    return { recovered: true, gaveUp: false, attempted: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    opts.echo?.(`leash re-entry failed: ${msg}`);
    return {
      recovered: false,
      gaveUp: opts.budget.tries >= LEASH_REENTRY_TRIES,
      attempted: true,
    };
  }
}
