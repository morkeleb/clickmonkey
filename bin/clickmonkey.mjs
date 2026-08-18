#!/usr/bin/env node
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist", "cli", "index.js");
if (existsSync(dist)) {
  await import(pathToFileURL(dist).href);
} else {
  const src = join(root, "src", "cli", "index.ts");
  const tsx = createRequire(import.meta.url).resolve("tsx");
  const result = spawnSync(process.execPath, ["--import", tsx, src, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
  });
  process.exit(result.status ?? 1);
}
