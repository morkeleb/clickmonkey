import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { formatStep, parseLine } from "../schema/dsl.js";
import type { Log, Step } from "../schema/log.js";

export interface CompactOpts {
  /** Step indexes in this log that changed URL (from nav.jsonl). */
  hopped?: ReadonlySet<number>;
}

function isSecretFill(step: Step): boolean {
  return step.kind === "fill" && /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(step.value);
}

function isSeedStep(step: Step): boolean {
  return step.kind === "open" || (step.kind === "click" && step.nav === true);
}

function canonicalStep(step: Step): string {
  if (step.kind === "click" && step.nav) {
    return formatStep({ kind: "click", surface: step.surface, id: step.id });
  }
  return formatStep(step);
}

/** How many leading tape steps are the same as `intro` (nav flag ignored). */
export function matchingIntroLength(steps: readonly Step[], intro: readonly string[]): number {
  if (intro.length === 0) return 0;
  const parsed: Step[] = [];
  for (let i = 0; i < intro.length; i++) {
    const line = intro[i]!;
    try {
      const p = parseLine(line, i + 1);
      if (!p || "comment" in p) return 0;
      parsed.push(p);
    } catch {
      return 0;
    }
  }
  if (steps.length < parsed.length) return 0;
  for (let i = 0; i < parsed.length; i++) {
    if (canonicalStep(steps[i]!) !== canonicalStep(parsed[i]!)) return 0;
  }
  return parsed.length;
}

export function replayableSteps(steps: readonly Step[], intro: readonly string[]): Step[] {
  const n = matchingIntroLength(steps, intro);
  return n > 0 ? steps.slice(n) : [...steps];
}

/**
 * Leading login clicks + $ENV fills + the submit click.
 * `open` / `click … nav` means the tape already landed — not intro.
 */
export function introPrefixLength(steps: readonly Step[]): number {
  let i = 0;
  let secrets = 0;
  for (; i < steps.length; i++) {
    const step = steps[i]!;
    if (secrets === 0 && isSeedStep(step)) return 0;
    if (isSecretFill(step)) {
      secrets += 1;
      continue;
    }
    if (secrets > 0 && step.kind === "click") return i + 1;
    if (secrets === 0 && step.kind === "click") continue;
    break;
  }
  return secrets > 0 ? i : 0;
}

function isResetStep(step: Step, index: number, hopped?: ReadonlySet<number>): boolean {
  if (step.kind === "open") return true;
  if (step.kind === "click" && step.nav === true) {
    return hopped?.has(index) === true;
  }
  return false;
}

/** Step indexes whose step→stepDone window contains a URL change. */
export function compactOptsForLog(logPath: string): CompactOpts | undefined {
  const sibling = join(dirname(logPath), "nav.jsonl");
  if (!existsSync(sibling)) return undefined;
  return { hopped: hoppedStepIndexes(readFileSync(sibling, "utf8")) };
}

export function hoppedStepIndexes(navText: string): Set<number> {
  const hopped = new Set<number>();
  let n = -1;
  let inStep = false;
  let sawHop = false;
  const flush = (): void => {
    if (inStep && sawHop && n >= 0) hopped.add(n);
    inStep = false;
    sawHop = false;
  };
  for (const raw of navText.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let ev: { type?: unknown; from?: unknown; to?: unknown; url?: unknown };
    try {
      ev = JSON.parse(raw) as { type?: unknown; from?: unknown; to?: unknown; url?: unknown };
    } catch {
      continue;
    }
    if (ev.type === "step") {
      flush();
      n += 1;
      inStep = true;
      continue;
    }
    if (ev.type === "stepDone") {
      flush();
      continue;
    }
    if (!inStep) continue;
    if (ev.type === "nav" && typeof ev.to === "string") {
      if (typeof ev.from !== "string" || ev.from !== ev.to) sawHop = true;
    }
    if (ev.type === "land" && typeof ev.url === "string") sawHop = true;
  }
  flush();
  return hopped;
}

/** Drop leash intro; keep from the last `open` or hopped nav click. */
export function compactLog(log: Log, opts?: CompactOpts): Log {
  const intro = introPrefixLength(log.steps);
  let lastReset = -1;
  for (let i = intro; i < log.steps.length; i++) {
    const step = log.steps[i];
    if (step && isResetStep(step, i, opts?.hopped)) lastReset = i;
  }
  const start = lastReset > intro ? lastReset : intro;
  return { ...log, steps: log.steps.slice(start) };
}
