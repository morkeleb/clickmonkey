import { FOG_FRESH_MS, fogHunger, type FogPipName } from "@schema/fog";

export const FOG_JOBS: readonly FogPipName[] = ["map", "unleash", "nasty", "spec"];

export const FOG_JOB_MARK: Record<FogPipName, string> = {
  map: "m",
  unleash: "u",
  nasty: "n",
  spec: "s",
};

/** Live unit letter. mcp is c so it is not explore (e). */
export const MONKEY_MARK: Record<string, string> = {
  map: "m",
  unleash: "u",
  nasty: "n",
  explore: "e",
  mcp: "c",
  spec: "s",
  test: "t",
};

export function fogOf(at: string | undefined, now = Date.now()): number {
  if (!at) return 1;
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return 1;
  return fogHunger(Math.max(0, now - t));
}

/** Same breakpoints as `fogHunger`: 0d green, 2d yellow, 40d / never red. */
const HUNGER_GREEN = fogHunger(0);
const HUNGER_YELLOW = fogHunger(FOG_FRESH_MS);

type Hsl = { h: number; s: number; l: number };

const HEAT_GREEN: Hsl = { h: 142, s: 70, l: 38 };
const HEAT_YELLOW: Hsl = { h: 48, s: 94, l: 48 };
const HEAT_ORANGE: Hsl = { h: 28, s: 90, l: 48 };
const HEAT_RED: Hsl = { h: 4, s: 80, l: 46 };

function mixHsl(a: Hsl, b: Hsl, t: number): string {
  const u = Math.min(1, Math.max(0, t));
  const h = Math.round(a.h + (b.h - a.h) * u);
  const s = Math.round(a.s + (b.s - a.s) * u);
  const l = Math.round(a.l + (b.l - a.l) * u);
  return `hsl(${h} ${s}% ${l}%)`;
}

/** Yellow → orange → red as hunger goes 0.65 → 1 (2d … 40d). */
function heatFromYellowToRed(t: number): string {
  const u = Math.min(1, Math.max(0, t));
  if (u <= 0.5) return mixHsl(HEAT_YELLOW, HEAT_ORANGE, u * 2);
  return mixHsl(HEAT_ORANGE, HEAT_RED, (u - 0.5) * 2);
}

/** Green (hunger 0.35) → yellow (0.65 / 2d) → red (1 / 40d or never). */
export function fogHeatColor(at: string | undefined, now = Date.now()): string {
  const hunger = fogOf(at, now);
  if (hunger <= HUNGER_GREEN) return mixHsl(HEAT_GREEN, HEAT_GREEN, 0);
  if (hunger >= 1) return mixHsl(HEAT_RED, HEAT_RED, 1);
  if (hunger <= HUNGER_YELLOW) {
    return mixHsl(HEAT_GREEN, HEAT_YELLOW, (hunger - HUNGER_GREEN) / (HUNGER_YELLOW - HUNGER_GREEN));
  }
  return heatFromYellowToRed((hunger - HUNGER_YELLOW) / (1 - HUNGER_YELLOW));
}

export function landAgeLabel(at: string | undefined, now = Date.now()): string {
  if (!at) return "never visited";
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return "never visited";
  const ms = now - t;
  if (ms < 0) return "visited just now";
  const hours = ms / 3_600_000;
  if (hours < 1) return "visited just now";
  if (hours < 48) return `visited ${Math.max(1, Math.round(hours))}h ago`;
  return `visited ${Math.max(1, Math.round(hours / 24))}d ago`;
}
