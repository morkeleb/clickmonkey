import { fogHunger, type WalkerJobName } from "@schema/fog";

export const FOG_JOBS: readonly WalkerJobName[] = ["map", "unleash", "nasty"];

export const FOG_JOB_MARK: Record<WalkerJobName, string> = {
  map: "m",
  unleash: "u",
  nasty: "n",
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

/** Green (fresh) → red (hungry). Stretches fogHunger 0.35…1 across the hue. */
export function fogHeatColor(at: string | undefined, now = Date.now()): string {
  const t = Math.min(1, Math.max(0, (fogOf(at, now) - 0.35) / 0.65));
  return `hsl(${Math.round(125 * (1 - t))} 72% 42%)`;
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
