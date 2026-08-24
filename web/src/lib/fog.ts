import { fogHunger } from "@schema/fog";

export function fogOf(lastLandAt: string | undefined, now = Date.now()): number {
  if (!lastLandAt) return 1;
  const t = Date.parse(lastLandAt);
  if (!Number.isFinite(t)) return 1;
  return fogHunger(Math.max(0, now - t));
}

export function landAgeLabel(lastLandAt: string | undefined, now = Date.now()): string {
  if (!lastLandAt) return "never visited";
  const t = Date.parse(lastLandAt);
  if (!Number.isFinite(t)) return "never visited";
  const ms = now - t;
  if (ms < 0) return "visited just now";
  const hours = ms / 3_600_000;
  if (hours < 1) return "visited just now";
  if (hours < 48) return `visited ${Math.max(1, Math.round(hours))}h ago`;
  return `visited ${Math.max(1, Math.round(hours / 24))}d ago`;
}
