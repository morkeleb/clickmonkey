import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { assertNotLegacyConfig, Config, LeashFile } from "../schema/config.js";
import { emptyDraft, PageModelDraft } from "../schema/page-model.js";
import { applyMissingPageDescriptions } from "../surveyor/describe.js";
import { mergeTrees } from "../surveyor/merge.js";
import { withFileLock } from "./lock.js";
import { ensureWorkspace, mapPath } from "./workspace.js";

function writeJson(path: string, value: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

function leashPayload(
  config: Pick<Config, "url" | "fence" | "intro" | "skip" | "writePolicy" | "screenshots" | "brain" | "vision">,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    url: config.url,
    intro: config.intro,
    writePolicy: config.writePolicy,
    screenshots: config.screenshots,
  };
  if (config.fence) out.fence = config.fence;
  if (config.skip && config.skip.length > 0) out.skip = config.skip;
  if (config.brain) out.brain = config.brain;
  if (config.vision) out.vision = config.vision;
  return out;
}

function readMapFile(path: string): PageModelDraft {
  return PageModelDraft.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function loadConfig(path: string): Config {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  assertNotLegacyConfig(raw);
  const leash = LeashFile.parse(raw);
  const shared = mapPath(path);
  let map: PageModelDraft;
  if (existsSync(shared)) {
    map = readMapFile(shared);
    if (map.pages.length === 0 && (leash.map?.pages.length ?? 0) > 0) {
      map = leash.map!;
    }
  } else if (leash.map) {
    map = leash.map;
  } else {
    map = emptyDraft();
  }
  applyMissingPageDescriptions(map.pages);
  return Config.parse({ ...leash, map });
}

/** Write the leash. Seeds `clickmonkey/map.json` when that file is missing or empty. */
export function saveConfig(path: string, config: Config): void {
  ensureWorkspace(path);
  writeJson(path, leashPayload(config));
  const shared = mapPath(path);
  withFileLock(shared, () => {
    if (!existsSync(shared)) {
      writeJson(shared, config.map);
      return;
    }
    if (config.map.pages.length === 0) return;
    const disk = readMapFile(shared);
    if (disk.pages.length === 0) writeJson(shared, config.map);
  });
}

/**
 * Union `map` into the shared `clickmonkey/map.json` under a file lock.
 * Parallel monkeys read-merge-write this file. The leash is not rewritten.
 */
export function persistSharedMap(path: string, map: PageModelDraft): Config {
  if (!existsSync(path)) {
    throw new Error(`config not found: ${path}`);
  }
  ensureWorkspace(path);
  const shared = mapPath(path);
  return withFileLock(shared, () => {
    const disk = loadConfig(path);
    const merged = mergeTrees(disk.map, map);
    applyMissingPageDescriptions(merged.pages);
    writeJson(shared, merged);
    return Config.parse({ ...disk, map: merged });
  });
}
