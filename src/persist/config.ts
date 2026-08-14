import { readFileSync, writeFileSync } from "node:fs";
import { assertNotLegacyConfig, Config } from "../schema/config.js";

export function loadConfig(path: string): Config {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  assertNotLegacyConfig(raw);
  return Config.parse(raw);
}

export function saveConfig(path: string, config: Config): void {
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
