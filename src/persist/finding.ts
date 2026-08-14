import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding } from "../schema/finding.js";

export function writeFinding(path: string, finding: Finding): void {
  writeFileSync(path, `${JSON.stringify(finding, null, 2)}\n`, "utf8");
}

export function persistFinding(outDir: string, finding: Finding): void {
  mkdirSync(outDir, { recursive: true });
  writeFinding(join(outDir, `${finding.id}.json`), finding);
}
