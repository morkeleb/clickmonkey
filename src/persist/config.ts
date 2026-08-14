import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { assertNotLegacyConfig, Config } from "../schema/config.js";
import type { PageModelDraft } from "../schema/page-model.js";
import { mergeTrees } from "../surveyor/merge.js";
import { withFileLock } from "./lock.js";

export function loadConfig(path: string): Config {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  assertNotLegacyConfig(raw);
  return Config.parse(raw);
}

export function saveConfig(path: string, config: Config): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

/**
 * Read the shared config, union `map` with disk, write back.
 * Leash fields (url, fence, intro, writePolicy) stay as on disk.
 */
export function persistSharedMap(path: string, map: PageModelDraft): Config {
  return withFileLock(path, () => {
    if (!existsSync(path)) {
      throw new Error(`config not found: ${path}`);
    }
    const disk = loadConfig(path);
    const merged = mergeTrees(disk.map, map);
    const next = Config.parse({ ...disk, map: merged });
    saveConfig(path, next);
    return next;
  });
}
