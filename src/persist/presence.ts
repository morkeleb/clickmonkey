import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { Presence, UiExploreOutline, type UiExploreOutline as Outline } from "../schema/ui.js";
import { identityFromRunId, pickDistinctHue } from "../ui/identity.js";

const liveOutDirs = new Set<string>();
let exitHook = false;

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
  const taken = listPresences(dirname(outDir))
    .filter((p) => p.id !== id && isPresenceLive(p))
    .map((p) => p.hue);
  const now = new Date().toISOString();
  const presence = Presence.parse({
    schemaVersion: 1,
    id,
    name: ident.name,
    hue: pickDistinctHue(taken, ident.hue),
    pid: process.pid,
    pageId: opts.pageId,
    startedAt: now,
    updatedAt: now,
    stoppedAt: null,
    ...(opts.brain ? { brain: opts.brain } : {}),
  });
  writePresence(presencePath(outDir), presence);
  trackLive(outDir);
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

function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
}

export function exploreOutlineOf(opts: {
  charter: string;
  now?: string;
  notes?: readonly string[];
  goods?: readonly string[];
  plan?: Outline["plan"];
}): Outline {
  const notes = (opts.notes ?? [])
    .map((n) => clip(n, 160))
    .filter(Boolean)
    .slice(-8);
  const goods = (opts.goods ?? [])
    .map((n) => clip(n, 160))
    .filter(Boolean)
    .slice(-8);
  const now = opts.now?.trim() ? clip(opts.now, 200) : undefined;
  return UiExploreOutline.parse({
    charter: clip(opts.charter, 400),
    ...(now ? { now } : {}),
    notes,
    goods,
    ...(opts.plan ? { plan: opts.plan } : {}),
  });
}

export function setPresenceOutline(outDir: string, outline: Outline): Presence | undefined {
  const path = presencePath(outDir);
  const prev = loadPresence(path);
  if (!prev || prev.stoppedAt) return prev;
  const next = Presence.parse({
    ...prev,
    outline,
    updatedAt: new Date().toISOString(),
  });
  writePresence(path, next);
  return next;
}

export function stopPresence(outDir: string): Presence | undefined {
  untrackLive(outDir);
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

/** Write stoppedAt when the walker pid is gone so a reused pid cannot revive the ring. */
export function stopPresenceIfDead(outDir: string): Presence | undefined {
  const prev = loadPresence(presencePath(outDir));
  if (!prev || prev.stoppedAt) return prev;
  if (pidAlive(prev.pid)) return prev;
  return stopPresence(outDir);
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: process exists, this user cannot signal it. Not a dead walker.
    return Boolean(err && typeof err === "object" && "code" in err && err.code === "EPERM");
  }
}

export function isPresenceLive(p: Presence): boolean {
  if (p.stoppedAt) return false;
  return pidAlive(p.pid);
}

function trackLive(outDir: string): void {
  liveOutDirs.add(outDir);
  if (exitHook) return;
  exitHook = true;
  process.on("exit", () => {
    for (const dir of [...liveOutDirs]) {
      try {
        stopPresence(dir);
      } catch {
        /* best-effort on process exit */
      }
    }
  });
}

function untrackLive(outDir: string): void {
  liveOutDirs.delete(outDir);
}

/**
 * Grok MCP reload spawns a new server and leaves the old one heartbeating.
 * Mark those walks offline. `touchPresence` will not revive a stopped file.
 */
export function reclaimMcpPresence(
  runsRoot: string,
  keep: { pid: number; id?: string },
): Presence[] {
  const out: Presence[] = [];
  for (const p of listPresences(runsRoot)) {
    if (p.brain !== "mcp") continue;
    if (p.stoppedAt) continue;
    if (p.pid === keep.pid && (keep.id === undefined || p.id === keep.id)) continue;
    const stopped = stopPresence(join(runsRoot, p.id));
    if (stopped) out.push(stopped);
  }
  return out;
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
