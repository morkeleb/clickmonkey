import { z } from "zod";
import { PageFog, type Page } from "./page-model.js";

/** Breakpoints: 2 days (light haze) and 40 days (full fog). */
export const FOG_FRESH_MS = 2 * 24 * 60 * 60 * 1000;
export const FOG_OLD_MS = 40 * 24 * 60 * 60 * 1000;

export const WalkerJobName = z.enum(["map", "unleash", "nasty"]);
export type WalkerJobName = z.infer<typeof WalkerJobName>;

export const WalkerModeName = z.enum(["wizard", "form", "list", "tab", "dialog", "empty", "nav"]);
export type WalkerModeName = z.infer<typeof WalkerModeName>;

export function jobOfBrain(brain?: string): WalkerJobName | undefined {
  if (brain === "map") return "map";
  if (brain === "unleash") return "unleash";
  if (brain === "unleash-nasty") return "nasty";
  return undefined;
}

/** Five monkeys. explore and mcp are different; only map/unleash/nasty stamp a job clock. */
export const MonkeyName = z.enum(["map", "unleash", "nasty", "explore", "mcp"]);
export type MonkeyName = z.infer<typeof MonkeyName>;

export function monkeyOfBrain(brain?: string): MonkeyName | undefined {
  if (brain === "unleash-nasty") return "nasty";
  const parsed = MonkeyName.safeParse(brain);
  return parsed.success ? parsed.data : undefined;
}

export function laterClock(a?: string, b?: string): string | undefined {
  const ta = a ? Date.parse(a) : Number.NaN;
  const tb = b ? Date.parse(b) : Number.NaN;
  const aOk = Number.isFinite(ta);
  const bOk = Number.isFinite(tb);
  if (!aOk) return bOk ? b : undefined;
  if (!bOk) return a;
  return tb > ta ? b : a;
}

/** Union two fog blobs; later ISO wins per clock. Missing side is not a wipe. */
export function mergePageFog(keep?: PageFog, other?: PageFog): PageFog | undefined {
  if (!keep) return other ? structuredClone(other) : undefined;
  if (!other) return keep;
  const jobs = { ...keep.jobs };
  for (const [key, at] of Object.entries(other.jobs)) {
    const next = laterClock(jobs[key], at);
    if (next) jobs[key] = next;
  }
  const modes = { ...keep.modes };
  for (const [key, at] of Object.entries(other.modes)) {
    const next = laterClock(modes[key], at);
    if (next) modes[key] = next;
  }
  const at = laterClock(keep.at, other.at) ?? keep.at;
  return { at, jobs, modes };
}

export function pageFogTimes(pages: readonly Pick<Page, "id" | "fog">[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const page of pages) {
    if (page.fog?.at) out[page.id] = page.fog.at;
  }
  return out;
}

export function jobFogTimes(
  pages: readonly Pick<Page, "id" | "fog">[],
  job: WalkerJobName,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const page of pages) {
    const at = page.fog?.jobs[job];
    if (at) out[page.id] = at;
  }
  return out;
}

/** Per-page job clocks for the sitemap heat pips. Missing job = full fog. */
export function jobFogOf(fog: PageFog | undefined): Partial<Record<WalkerJobName, string>> | undefined {
  if (!fog) return undefined;
  const out: Partial<Record<WalkerJobName, string>> = {};
  for (const job of WalkerJobName.options) {
    const at = fog.jobs[job];
    if (at) out[job] = at;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function modeFogKey(pageId: string, mode: WalkerModeName): string {
  return `${pageId}/${mode}`;
}

export function modeFogTimes(pages: readonly Pick<Page, "id" | "fog">[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const page of pages) {
    for (const [mode, at] of Object.entries(page.fog?.modes ?? {})) {
      out[`${page.id}/${mode}`] = at;
    }
  }
  return out;
}

export function fogHunger(staleMs: number): number {
  const age = Math.max(0, staleMs);
  if (age >= FOG_OLD_MS) return 1;
  if (age <= FOG_FRESH_MS) return 0.35 + 0.3 * (age / FOG_FRESH_MS);
  return 0.65 + 0.35 * ((age - FOG_FRESH_MS) / (FOG_OLD_MS - FOG_FRESH_MS));
}

/** Missing/invalid last land = full fog. */
export function staleMsForPage(
  clocks: Readonly<Record<string, string>> | undefined,
  pageId: string,
  now = Date.now(),
): number {
  const at = clocks?.[pageId];
  if (!at) return FOG_OLD_MS;
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return FOG_OLD_MS;
  return Math.max(0, now - t);
}
