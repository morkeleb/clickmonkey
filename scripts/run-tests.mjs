import { globSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Unit: files named *.unit.test.ts. Live: every other *.test.ts under tests/.
// Do not list files in package.json — add a file and it is included.
export function listTestFiles(mode) {
  if (mode !== "unit" && mode !== "live") {
    throw new Error(`mode must be unit or live, got ${String(mode)}`);
  }
  return globSync("tests/**/*.test.ts")
    .filter((file) => !file.includes("/helpers/"))
    .filter((file) => {
      const unit = file.endsWith(".unit.test.ts");
      return mode === "unit" ? unit : !unit;
    })
    .sort();
}

function main() {
  const mode = process.argv[2];
  if (mode !== "unit" && mode !== "live") {
    process.stderr.write("usage: node scripts/run-tests.mjs unit|live\n");
    process.exit(2);
  }
  const files = listTestFiles(mode);
  if (files.length === 0) {
    process.stderr.write(`no ${mode} tests under tests/**/*.test.ts\n`);
    process.exit(1);
  }
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status === null ? 1 : result.status);
  if (mode === "unit") {
    const webTests = globSync("src/**/*.unit.test.ts", { cwd: resolve("web") });
    if (webTests.length > 0) {
      const web = spawnSync(process.execPath, ["--import", "tsx", "--test", ...webTests], {
        cwd: resolve("web"),
        stdio: "inherit",
      });
      process.exit(web.status === null ? 1 : web.status);
    }
  }
  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
