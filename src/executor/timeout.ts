import type { BrowserContext, Page } from "playwright";

/** Same default as Playwright / `withRun` when `--timeout` is omitted. */
export const DEFAULT_ACTION_TIMEOUT_MS = 30_000;

const contextTimeouts = new WeakMap<BrowserContext, number>();

/** Record the walker's `--timeout` so fills can share it instead of guessing 500ms. */
export function rememberActionTimeout(context: BrowserContext, timeoutMs: number): void {
  contextTimeouts.set(context, timeoutMs);
}

/** Remaining-action budget: the context default from `--timeout`, not a short hardcoded wait. */
export function actionTimeoutMs(page: Page): number {
  const n = contextTimeouts.get(page.context());
  return typeof n === "number" && n > 0 ? n : DEFAULT_ACTION_TIMEOUT_MS;
}

/** Absolute time when this fill/open must stop. */
export function actionDeadline(page: Page, now = Date.now()): number {
  return now + actionTimeoutMs(page);
}

/** Ms left on a deadline. 0 means abort — do not start another Playwright action. */
export function remainingTimeoutMs(deadline: number, now = Date.now()): number {
  return Math.max(0, deadline - now);
}

/**
 * One Playwright click/fill/press/wait from a shared `--timeout` budget.
 * `attempts` splits the remainder so 8 locators cannot each sit for the full budget.
 */
export function sliceTimeoutMs(
  deadline: number,
  opts?: { cap?: number; attempts?: number; now?: number },
): number {
  const left = remainingTimeoutMs(deadline, opts?.now);
  if (left <= 0) return 0;
  const attempts = Math.max(1, opts?.attempts ?? 1);
  const share = Math.max(1, Math.floor(left / attempts));
  const capped = opts?.cap !== undefined ? Math.min(opts.cap, share) : share;
  return Math.min(left, capped);
}

/**
 * Peek/read: try once. Playwright `timeout: 0` is "no timeout" on some waits
 * (hang forever); omitting it uses `--timeout`. Neither is acceptable after every step.
 */
export const PEEK_TIMEOUT_MS = 1;

/** Floor so a 600ms debounce still paints. Scales with `--timeout` — never 500ms. */
export const MIN_LIST_WAIT_MS = 1_200;

/** Wait for listed rows after open. Slow machines pass a larger `--timeout`. */
export function typeaheadListWaitMs(page: Page): number {
  const t = actionTimeoutMs(page);
  return Math.min(t, Math.max(MIN_LIST_WAIT_MS, Math.floor(t / 4)));
}
