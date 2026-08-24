import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  emptyLands,
  jobOfBrain,
  migrateLands,
  LandsLedger,
  type WalkerJobName,
  type WalkerModeName,
} from "../schema/fog.js";
import { withFileLock } from "./lock.js";
import { ensureWorkspace, workspaceDir } from "./workspace.js";

export function landsPath(configPath: string): string {
  return join(workspaceDir(configPath), "lands.json");
}

function readLandsFile(path: string): { ledger: LandsLedger; writable: boolean } {
  if (!existsSync(path)) return { ledger: emptyLands(), writable: true };
  try {
    return { ledger: migrateLands(JSON.parse(readFileSync(path, "utf8"))), writable: true };
  } catch {
    return { ledger: emptyLands(), writable: false };
  }
}

export function loadLands(configPath: string): LandsLedger {
  return readLandsFile(landsPath(configPath)).ledger;
}

export function shouldStampLand(state: { replay?: boolean }, notFound: boolean): boolean {
  return !state.replay && !notFound;
}

export type LandStamp = {
  at?: string;
  job?: WalkerJobName;
  mode?: WalkerModeName;
};

function stampOf(atOrStamp?: string | LandStamp): Required<Pick<LandStamp, "at">> & LandStamp {
  if (typeof atOrStamp === "string" || atOrStamp === undefined) {
    return { at: typeof atOrStamp === "string" ? atOrStamp : new Date().toISOString() };
  }
  return { ...atOrStamp, at: atOrStamp.at ?? new Date().toISOString() };
}

/** Persist last land once per page stay. Skip replay. */
export function recordLand(state: {
  configPath?: string;
  replay?: boolean;
  pageId: string;
  lastLandPageId?: string;
  brain?: string;
}): void {
  if (state.replay || !state.configPath) return;
  const pageId = state.pageId.trim();
  if (!pageId || state.lastLandPageId === pageId) return;
  try {
    touchLand(state.configPath, pageId, { job: jobOfBrain(state.brain) });
    state.lastLandPageId = pageId;
  } catch {
    // land write must not stall the walk
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
    touchLand(state.configPath, id, { mode });
  } catch {
    // land write must not stall the walk
  }
}

export function touchLand(
  configPath: string,
  pageId: string,
  atOrStamp?: string | LandStamp,
): LandsLedger {
  const id = pageId.trim();
  if (!id) return loadLands(configPath);
  const stamp = stampOf(atOrStamp);
  ensureWorkspace(configPath);
  const path = landsPath(configPath);
  return withFileLock(path, () => {
    const { ledger, writable } = readLandsFile(path);
    if (!writable) return ledger;
    const prev = ledger.pages[id] ?? { at: stamp.at, jobs: {}, modes: {} };
    const next = {
      at: stamp.at,
      jobs: { ...prev.jobs },
      modes: { ...prev.modes },
    };
    if (stamp.job) next.jobs[stamp.job] = stamp.at;
    if (stamp.mode) next.modes[stamp.mode] = stamp.at;
    ledger.pages[id] = next;
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
    renameSync(tmp, path);
    return ledger;
  });
}
