import { z } from "zod";

/** Breakpoints: 2 days (light haze) and 40 days (full fog). */
export const FOG_FRESH_MS = 2 * 24 * 60 * 60 * 1000;
export const FOG_OLD_MS = 40 * 24 * 60 * 60 * 1000;

export const WalkerJobName = z.enum(["map", "unleash", "nasty"]);
export type WalkerJobName = z.infer<typeof WalkerJobName>;

export const WalkerModeName = z.enum(["wizard", "form", "list", "tab", "dialog", "empty", "nav"]);
export type WalkerModeName = z.infer<typeof WalkerModeName>;

export const PageLand = z
  .object({
    at: z.string().min(1),
    jobs: z.record(z.string().min(1), z.string().min(1)).default({}),
    modes: z.record(z.string().min(1), z.string().min(1)).default({}),
  })
  .strict();
export type PageLand = z.infer<typeof PageLand>;

export const LandsLedgerV1 = z
  .object({
    schemaVersion: z.literal(1),
    pages: z.record(z.string().min(1), z.string().min(1)),
  })
  .strict();
export type LandsLedgerV1 = z.infer<typeof LandsLedgerV1>;

export const LandsLedger = z
  .object({
    schemaVersion: z.literal(2),
    pages: z.record(z.string().min(1), PageLand),
  })
  .strict();
export type LandsLedger = z.infer<typeof LandsLedger>;

export function emptyLands(): LandsLedger {
  return { schemaVersion: 2, pages: {} };
}

export function migrateLands(raw: unknown): LandsLedger {
  if (raw && typeof raw === "object" && (raw as { schemaVersion?: unknown }).schemaVersion === 1) {
    const v1 = LandsLedgerV1.parse(raw);
    const pages: Record<string, PageLand> = {};
    for (const [id, at] of Object.entries(v1.pages)) {
      pages[id] = { at, jobs: {}, modes: {} };
    }
    return { schemaVersion: 2, pages };
  }
  return LandsLedger.parse(raw);
}

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

export function landTimes(ledger: LandsLedger): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, page] of Object.entries(ledger.pages)) out[id] = page.at;
  return out;
}

export function jobLandTimes(ledger: LandsLedger, job: WalkerJobName): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, page] of Object.entries(ledger.pages)) {
    const at = page.jobs[job];
    if (at) out[id] = at;
  }
  return out;
}

/** Per-page job clocks for the sitemap heat pips. Missing job = full fog. */
export function jobLandsOf(page: PageLand | undefined): Partial<Record<WalkerJobName, string>> | undefined {
  if (!page) return undefined;
  const out: Partial<Record<WalkerJobName, string>> = {};
  for (const job of WalkerJobName.options) {
    const at = page.jobs[job];
    if (at) out[job] = at;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function modeLandKey(pageId: string, mode: WalkerModeName): string {
  return `${pageId}/${mode}`;
}

export function modeLandTimes(ledger: LandsLedger): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, page] of Object.entries(ledger.pages)) {
    for (const [mode, at] of Object.entries(page.modes)) {
      out[`${id}/${mode}`] = at;
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
  pageLands: Readonly<Record<string, string>> | undefined,
  pageId: string,
  now = Date.now(),
): number {
  const at = pageLands?.[pageId];
  if (!at) return FOG_OLD_MS;
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return FOG_OLD_MS;
  return Math.max(0, now - t);
}
