import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { workspaceDir } from "./workspace.js";

/** Gitignored sidecar: one-line origin written by a port assigner (e.g. fde-dev). */
export const DEV_ORIGIN_NAME = "dev-origin";

export function devOriginPath(configPath: string): string {
  return join(workspaceDir(configPath), DEV_ORIGIN_NAME);
}

export function readDevOrigin(configPath: string): string | undefined {
  const path = devOriginPath(configPath);
  if (!existsSync(path)) return undefined;
  const line = readFileSync(path, "utf8")
    .split("\n")
    .map((row) => row.trim())
    .find((row) => row.length > 0 && !row.startsWith("#"));
  if (!line) return undefined;
  try {
    const origin = new URL(line).origin;
    if (origin === "null") {
      throw new Error(`clickmonkey/dev-origin is not a URL: ${line}`);
    }
    return origin;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("clickmonkey/dev-origin")) throw err;
    throw new Error(`clickmonkey/dev-origin is not a URL: ${line}`);
  }
}

/** Keep leash path/query/hash; replace scheme/host/port from the sidecar. */
export function applyDevOrigin(url: string, origin: string | undefined): string {
  if (!origin) return url;
  const next = new URL(url);
  const from = new URL(origin);
  next.protocol = from.protocol;
  next.hostname = from.hostname;
  next.port = from.port;
  return next.href;
}
