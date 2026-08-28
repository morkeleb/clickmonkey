import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/** Folder next to the leash file. Map, ledgers, and runs live here. */
export const WORKSPACE_DIR = "clickmonkey";

export function workspaceDir(configPath: string): string {
  return join(dirname(configPath), WORKSPACE_DIR);
}

export function ensureWorkspace(configPath: string): string {
  const dir = workspaceDir(configPath);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function mapPath(configPath: string): string {
  return join(workspaceDir(configPath), "map.json");
}

export function testabilityPath(configPath: string): string {
  return join(workspaceDir(configPath), "testability.json");
}

export function qualityPath(configPath: string): string {
  return join(workspaceDir(configPath), "quality.json");
}

export function brokenPath(configPath: string): string {
  return join(workspaceDir(configPath), "broken.json");
}

export function runsDir(configPath: string): string {
  return join(workspaceDir(configPath), "runs");
}

export function replaysDir(configPath: string): string {
  return join(workspaceDir(configPath), "replays");
}

export function reportsDir(configPath: string): string {
  return join(workspaceDir(configPath), "reports");
}

export function specsDir(configPath: string): string {
  return join(workspaceDir(configPath), "specs");
}

/** Generated TypeScript page model (`clickmonkey emit`). */
export function tsDir(configPath: string): string {
  return join(workspaceDir(configPath), "ts");
}

export function generatedTsPath(configPath: string): string {
  return join(tsDir(configPath), "generated.ts");
}

/** Pre-folder sibling. Read-only fallback. */
export function legacyTestabilityPath(configPath: string): string {
  return configPath.replace(/\.json$/i, "") + ".testability.json";
}

/** Pre-folder sibling. Read-only fallback. */
export function legacyBrokenPath(configPath: string): string {
  return configPath.replace(/\.json$/i, "") + ".broken.json";
}
