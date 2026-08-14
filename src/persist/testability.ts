import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import {
  emptyTestabilityReport,
  TestabilityReport,
  upsertTestabilityPage,
  type TestabilityPage,
} from "../schema/testability.js";
import { withFileLock } from "./lock.js";

export function testabilityReportPath(configPath: string): string {
  return configPath.replace(/\.json$/i, "") + ".testability.json";
}

function writeReport(path: string, report: TestabilityReport): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function loadTestabilityReport(path: string): TestabilityReport {
  if (!existsSync(path)) return emptyTestabilityReport();
  return TestabilityReport.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** Replace the entry for this path. Map file is never touched. */
export function persistTestabilityPage(configPath: string, page: TestabilityPage): TestabilityReport {
  const path = testabilityReportPath(configPath);
  return withFileLock(path, () => {
    const disk = loadTestabilityReport(path);
    const next = upsertTestabilityPage(disk, page);
    writeReport(path, next);
    return next;
  });
}
