import type { Log, Step } from "../schema/log.js";

function isSecretFill(step: Step): boolean {
  return step.kind === "fill" && /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(step.value);
}

/** Intro clicks + $ENV fills at the start of a leash tape. */
export function introPrefixLength(steps: readonly Step[]): number {
  let i = 0;
  let secrets = 0;
  for (; i < steps.length; i++) {
    const step = steps[i]!;
    if (isSecretFill(step)) {
      secrets += 1;
      continue;
    }
    if (secrets > 0 && step.kind === "click") return i + 1;
    if (secrets === 0 && (step.kind === "click" || step.kind === "open")) continue;
    break;
  }
  return secrets > 0 ? i : 0;
}

function isResetStep(step: Step): boolean {
  return step.kind === "open" || (step.kind === "click" && step.nav === true);
}

/**
 * Path from landing to the error. Drops leash intro (`$ENV` fills) — replay
 * runs intro from the config. Then keeps from the last `open` or nav-landmark
 * click (both re-seed the page in typical apps) through the end, including
 * every fill after that. No last-N trim.
 */
export function compactLog(log: Log): Log {
  const intro = introPrefixLength(log.steps);
  let lastReset = -1;
  for (let i = intro; i < log.steps.length; i++) {
    const step = log.steps[i];
    if (step && isResetStep(step)) lastReset = i;
  }
  const start = lastReset > intro ? lastReset : intro;
  return { ...log, steps: log.steps.slice(start) };
}
