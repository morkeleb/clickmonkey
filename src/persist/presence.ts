import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Presence } from "../schema/ui.js";
import { identityFromRunId } from "../ui/identity.js";

export const PRESENCE_STALE_MS = 15_000;

export function presencePath(outDir: string): string {
  return join(outDir, "presence.json");
}

function writePresence(path: string, presence: Presence): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(presence, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function loadPresence(path: string): Presence | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return Presence.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return undefined;
  }
}

export function startPresence(
  outDir: string,
  opts: { pageId: string; brain?: string; replay?: boolean },
): Presence | undefined {
  if (opts.replay) return undefined;
  const id = basename(outDir);
  const ident = identityFromRunId(id);
  const now = new Date().toISOString();
  const presence = Presence.parse({
    schemaVersion: 1,
    id,
    name: ident.name,
    hue: ident.hue,
    pid: process.pid,
    pageId: opts.pageId,
    startedAt: now,
    updatedAt: now,
    stoppedAt: null,
    ...(opts.brain ? { brain: opts.brain } : {}),
  });
  writePresence(presencePath(outDir), presence);
  return presence;
}

export function touchPresence(outDir: string, pageId: string): Presence | undefined {
  const path = presencePath(outDir);
  const prev = loadPresence(path);
  if (!prev || prev.stoppedAt) return prev;
  const next = Presence.parse({
    ...prev,
    pageId,
    updatedAt: new Date().toISOString(),
  });
  writePresence(path, next);
  return next;
}

export function stopPresence(outDir: string): Presence | undefined {
  const path = presencePath(outDir);
  const prev = loadPresence(path);
  if (!prev) return undefined;
  const now = new Date().toISOString();
  const next = Presence.parse({
    ...prev,
    updatedAt: now,
    stoppedAt: prev.stoppedAt ?? now,
  });
  writePresence(path, next);
  return next;
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function isPresenceLive(p: Presence, now = Date.now()): boolean {
  if (p.stoppedAt) return false;
  const age = now - Date.parse(p.updatedAt);
  if (Number.isFinite(age) && age <= PRESENCE_STALE_MS) return true;
  return pidAlive(p.pid);
}

export function listPresences(runsRoot: string): Presence[] {
  if (!existsSync(runsRoot)) return [];
  const out: Presence[] = [];
  for (const name of readdirSync(runsRoot)) {
    const p = loadPresence(join(runsRoot, name, "presence.json"));
    if (p) out.push(p);
  }
  return out;
}
