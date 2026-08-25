import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { jobOfBrain, mergePageFog, type WalkerJobName, type WalkerModeName } from "../schema/fog.js";
import {
  emptyDraft,
  PageFog,
  parsePageModelDraft,
  type PageModelDraft,
} from "../schema/page-model.js";
import { withFileLock } from "./lock.js";
import { ensureWorkspace, mapPath, workspaceDir } from "./workspace.js";

/** Leftover sidecar from before fog lived on the sitemap page. */
export function leftoverFogPath(configPath: string): string {
  return join(workspaceDir(configPath), "lands.json");
}

function writeJson(path: string, value: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

const LeftoverFogV1 = z
  .object({
    schemaVersion: z.literal(1),
    pages: z.record(z.string().min(1), z.string().min(1)),
  })
  .strict();

const LeftoverFogV2 = z
  .object({
    schemaVersion: z.literal(2),
    pages: z.record(z.string().min(1), PageFog),
  })
  .strict();

function readLeftoverFog(path: string): Record<string, PageFog> {
  if (!existsSync(path)) return {};
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (raw && typeof raw === "object" && (raw as { schemaVersion?: unknown }).schemaVersion === 1) {
      const v1 = LeftoverFogV1.parse(raw);
      const pages: Record<string, PageFog> = {};
      for (const [id, at] of Object.entries(v1.pages)) pages[id] = { at, jobs: {}, modes: {} };
      return pages;
    }
    return LeftoverFogV2.parse(raw).pages;
  } catch {
    return {};
  }
}

function readMapDraft(configPath: string): PageModelDraft {
  const path = mapPath(configPath);
  if (!existsSync(path)) return emptyDraft();
  return parsePageModelDraft(JSON.parse(readFileSync(path, "utf8")));
}

/** Overlay leftover `lands.json` onto sitemap pages. Does not write or delete. */
export function absorbLeftoverFog(configPath: string, map: PageModelDraft): PageModelDraft {
  const leftover = readLeftoverFog(leftoverFogPath(configPath));
  if (Object.keys(leftover).length === 0) return map;
  for (const page of map.pages) {
    const blob = leftover[page.id];
    if (!blob) continue;
    const fog = mergePageFog(page.fog, blob);
    if (fog) page.fog = fog;
  }
  return map;
}

export function dropLeftoverFog(configPath: string): void {
  const path = leftoverFogPath(configPath);
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch {
    /* leftover file is optional */
  }
}

export function loadMapPages(configPath: string): PageModelDraft["pages"] {
  return absorbLeftoverFog(configPath, readMapDraft(configPath)).pages;
}

export function shouldStampFog(state: { replay?: boolean }, notFound: boolean): boolean {
  return !state.replay && !notFound;
}

export type FogStamp = {
  at?: string;
  job?: WalkerJobName;
  mode?: WalkerModeName;
};

function stampOf(atOrStamp?: string | FogStamp): Required<Pick<FogStamp, "at">> & FogStamp {
  if (typeof atOrStamp === "string" || atOrStamp === undefined) {
    return { at: typeof atOrStamp === "string" ? atOrStamp : new Date().toISOString() };
  }
  return { ...atOrStamp, at: atOrStamp.at ?? new Date().toISOString() };
}

function applyStamp(prev: PageFog | undefined, stamp: Required<Pick<FogStamp, "at">> & FogStamp): PageFog {
  const next: PageFog = {
    at: stamp.at,
    jobs: { ...prev?.jobs },
    modes: { ...prev?.modes },
  };
  if (stamp.job) next.jobs[stamp.job] = stamp.at;
  if (stamp.mode) next.modes[stamp.mode] = stamp.at;
  return next;
}

/** Persist last land once per page stay. Skip replay. */
export function recordFog(state: {
  configPath?: string;
  replay?: boolean;
  pageId: string;
  lastFogPageId?: string;
  brain?: string;
}): void {
  if (state.replay || !state.configPath) return;
  const pageId = state.pageId.trim();
  if (!pageId || state.lastFogPageId === pageId) return;
  try {
    stampFog(state.configPath, pageId, { job: jobOfBrain(state.brain) });
    state.lastFogPageId = pageId;
  } catch {
    // fog write must not stall the walk
  }
}

/** Stamp a mode on this page. Every exercise, not once per stay. */
export function recordMode(
  state: { configPath?: string; replay?: boolean },
  pageId: string,
  mode: WalkerModeName,
): void {
  if (state.replay || !state.configPath) return;
  const id = pageId.trim();
  if (!id) return;
  try {
    stampFog(state.configPath, id, { mode });
  } catch {
    // fog write must not stall the walk
  }
}

/** Stamp fog on a sitemap page. No-op when that page is not on the map yet. */
export function stampFog(
  configPath: string,
  pageId: string,
  atOrStamp?: string | FogStamp,
): PageModelDraft {
  const id = pageId.trim();
  if (!id) return absorbLeftoverFog(configPath, readMapDraft(configPath));
  const stamp = stampOf(atOrStamp);
  ensureWorkspace(configPath);
  const path = mapPath(configPath);
  return withFileLock(path, () => {
    const map = absorbLeftoverFog(configPath, readMapDraft(configPath));
    const page = map.pages.find((p) => p.id === id);
    if (page) page.fog = applyStamp(page.fog, stamp);
    writeJson(path, map);
    dropLeftoverFog(configPath);
    return map;
  });
}

/**
 * Wipe fog on sitemap pages. Full reset drops `fog` on every page.
 * A job name drops that clock only and leaves `at` / other jobs / modes.
 */
export function resetFog(configPath: string, job?: WalkerJobName): PageModelDraft {
  ensureWorkspace(configPath);
  const path = mapPath(configPath);
  return withFileLock(path, () => {
    const map = absorbLeftoverFog(configPath, readMapDraft(configPath));
    for (const page of map.pages) {
      if (!page.fog) continue;
      if (!job) {
        delete page.fog;
        continue;
      }
      delete page.fog.jobs[job];
    }
    writeJson(path, map);
    dropLeftoverFog(configPath);
    return map;
  });
}

function ageLabel(at: string | undefined, now: number): string {
  if (!at) return "never";
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return "never";
  const ms = now - t;
  if (ms < 3_600_000) return "now";
  const hours = ms / 3_600_000;
  if (hours < 48) return `${Math.max(1, Math.round(hours))}h`;
  return `${Math.max(1, Math.round(hours / 24))}d`;
}

/** Compact clock dump for `clickmonkey fog`. One line per sitemap page. */
export function formatFogStatus(map: PageModelDraft, path: string, now = Date.now()): string {
  const pages = [...map.pages].sort((a, b) => a.id.localeCompare(b.id));
  const noun = pages.length === 1 ? "page" : "pages";
  const header = `${path}  ${pages.length} ${noun}${pages.length === 0 ? "  (full fog)" : ""}\n`;
  if (pages.length === 0) return header;
  const jobs: WalkerJobName[] = ["map", "unleash", "nasty"];
  const lines = pages.map((page) => {
    const fog = page.fog;
    const jobPart = jobs.map((name) => `${name} ${ageLabel(fog?.jobs[name], now)}`).join("  ");
    const modePart = Object.entries(fog?.modes ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mode, at]) => `${mode} ${ageLabel(at, now)}`)
      .join(", ");
    return `${page.id}  at ${ageLabel(fog?.at, now)}  ${jobPart}${modePart ? `  ${modePart}` : ""}`;
  });
  return `${header}${lines.join("\n")}\n`;
}
