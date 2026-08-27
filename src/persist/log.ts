import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { formatLog, parseLog } from "../schema/dsl.js";
import { redactEnvInText } from "../executor/secrets.js";
import type { Log, UsedLocator } from "../schema/log.js";

export function readLog(path: string): Log {
  return parseLog(readFileSync(path, "utf8"));
}

export function writeLog(path: string, log: Log): void {
  writeFileSync(path, redactEnvInText(formatLog(log)), "utf8");
}

export function hashUsedLocators(map: Record<string, UsedLocator>): string {
  const normalized: Record<string, { by: string; value: string; name?: string }> = {};
  for (const key of Object.keys(map).sort()) {
    const loc = map[key];
    if (!loc) continue;
    normalized[key] = {
      by: loc.by,
      value: loc.value,
      ...(loc.name ? { name: loc.name } : {}),
    };
  }
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
