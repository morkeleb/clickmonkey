import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { loadCombinedBroken } from "./broken.js";
import { withFileLock } from "./lock.js";
import { listRuns } from "./runs.js";
import { absorbLeftoverFog, dropLeftoverFog } from "./fog.js";
import { mapPath } from "./workspace.js";
import type { BrokenEntry, BrokenReport } from "../schema/broken.js";
import { emptyDraft, parsePageModelDraft, type Page, type PageModelDraft } from "../schema/page-model.js";
import { ledgerPath, pathHasParams } from "../surveyor/path-template.js";

export type InboundDoor = {
  from: string;
  live: boolean;
};

export type PageGcRow = {
  id: string;
  path: string;
  at?: string;
  inboundLive: number;
  inboundDead: number;
  notFound: boolean;
  notFoundPath?: string;
  special?: "entry" | "origin" | "params";
  recommend: boolean;
  why?: string;
};

function writeJson(path: string, value: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
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

function isLiveStatus(status: string | undefined): boolean {
  return status !== "unresolved" && status !== "drift";
}

export function inboundDoors(pages: readonly Page[], targetId: string): InboundDoor[] {
  const out: InboundDoor[] = [];
  for (const page of pages) {
    if (page.id === targetId) continue;
    for (const surface of page.surfaces) {
      for (const action of surface.actions) {
        if (action.opens !== targetId) continue;
        out.push({
          from: `${page.id}.${surface.id}.${action.id}`,
          live: isLiveStatus(action.status),
        });
      }
    }
  }
  return out;
}

function document404s(broken: BrokenReport): BrokenEntry[] {
  return broken.entries.filter(
    (e) => e.status === 404 && (e.resourceType === undefined || e.resourceType === "document"),
  );
}

function notFoundFor(page: Page, broken: BrokenReport): BrokenEntry | undefined {
  const key = ledgerPath(page.path);
  return document404s(broken).find((e) => ledgerPath(e.path) === key);
}

function specialOf(page: Page): PageGcRow["special"] {
  if (page.entry) return "entry";
  if (page.origin) return "origin";
  if (pathHasParams(page)) return "params";
  return undefined;
}

export function pageGcRows(map: PageModelDraft, broken: BrokenReport): PageGcRow[] {
  return [...map.pages]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((page) => {
      const inbound = inboundDoors(map.pages, page.id);
      const live = inbound.filter((d) => d.live).length;
      const dead = inbound.length - live;
      const miss = notFoundFor(page, broken);
      const special = specialOf(page);
      const notFound = Boolean(miss);
      const recommend = notFound && live === 0 && !special;
      const why = recommend
        ? dead > 0
          ? `404 ${miss!.path}; ${dead} inbound unresolved`
          : `404 ${miss!.path}; no inbound`
        : undefined;
      return {
        id: page.id,
        path: page.path,
        ...(page.fog?.at ? { at: page.fog.at } : {}),
        inboundLive: live,
        inboundDead: dead,
        notFound,
        ...(miss ? { notFoundPath: miss.path } : {}),
        ...(special ? { special } : {}),
        recommend,
        ...(why ? { why } : {}),
      };
    });
}

export function loadBrokenForGc(configPath: string): BrokenReport {
  return loadCombinedBroken(
    listRuns(configPath).map((r) => r.dir),
    configPath,
  );
}

/** Compact listing plus a recommend-drop block. Hunger alone is never a recommend. */
export function formatPagesStatus(
  map: PageModelDraft,
  broken: BrokenReport,
  now = Date.now(),
): string {
  const rows = pageGcRows(map, broken);
  const noun = rows.length === 1 ? "page" : "pages";
  const lines = [
    `${rows.length} ${noun}`,
    ...rows.map((row) => {
      const bits = [
        row.id,
        row.path,
        `at ${ageLabel(row.at, now)}`,
        `in ${row.inboundLive}`,
      ];
      if (row.notFound) bits.push("404");
      if (row.special) bits.push(row.special);
      return bits.join("  ");
    }),
  ];
  const rec = rows.filter((r) => r.recommend);
  if (rec.length === 0) {
    lines.push("", "Recommend drop: (none)");
  } else {
    lines.push("", "Recommend drop:");
    for (const row of rec) {
      lines.push(`  ${row.id}  ${row.why}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function readMapDraft(configPath: string): PageModelDraft {
  const path = mapPath(configPath);
  if (!existsSync(path)) return emptyDraft();
  return parsePageModelDraft(JSON.parse(readFileSync(path, "utf8")));
}

function stripOpens(pages: Page[], dropped: ReadonlySet<string>): void {
  for (const page of pages) {
    for (const surface of page.surfaces) {
      for (const action of surface.actions) {
        if (action.opens && dropped.has(action.opens)) delete action.opens;
      }
    }
  }
}

export function dropMapPages(configPath: string, ids: readonly string[]): {
  dropped: string[];
  map: PageModelDraft;
} {
  const want = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (want.length === 0) throw new Error("no page ids to drop");
  const path = mapPath(configPath);
  if (!existsSync(path)) throw new Error(`map not found: ${path}`);
  return withFileLock(path, () => {
    const map = absorbLeftoverFog(configPath, readMapDraft(configPath));
    const have = new Set(map.pages.map((p) => p.id));
    const missing = want.filter((id) => !have.has(id));
    if (missing.length > 0) throw new Error(`unknown page id: ${missing.join(", ")}`);
    const drop = new Set(want);
    map.pages = map.pages.filter((p) => !drop.has(p.id));
    stripOpens(map.pages, drop);
    writeJson(path, map);
    dropLeftoverFog(configPath);
    return { dropped: want, map };
  });
}
