import { writeFileSync } from "node:fs";
import type { Finding } from "../schema/finding.js";

export function writeFinding(path: string, finding: Finding): void {
  writeFileSync(path, `${JSON.stringify(finding, null, 2)}\n`, "utf8");
}
