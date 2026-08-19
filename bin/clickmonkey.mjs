#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist", "cli", "index.js");
const srcDir = join(root, "src");

function srcNewerThan(distFile) {
  if (!existsSync(srcDir) || !existsSync(distFile)) return !existsSync(distFile);
  const distM = statSync(distFile).mtimeMs;
  const stack = [srcDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) stack.push(p);
      else if (name.endsWith(".ts") && st.mtimeMs > distM) return true;
    }
  }
  return false;
}

if (existsSync(dist) && !srcNewerThan(dist)) {
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
