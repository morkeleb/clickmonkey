import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import {
  emptyTestabilityReport,
  TestabilityReport,
  upsertTestabilityPage,
  type TestabilityPage,
} from "../schema/testability.js";
import { withFileLock } from "./lock.js";
import { ensureWorkspace, legacyTestabilityPath, testabilityPath } from "./workspace.js";

export function testabilityReportPath(configPath: string): string {
  return testabilityPath(configPath);
}

function resolveTestabilityReadPath(configPath: string): string {
  const next = testabilityPath(configPath);
  if (existsSync(next)) return next;
  const legacy = legacyTestabilityPath(configPath);
  if (existsSync(legacy)) return legacy;
  return next;
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

/** Replace the entry for this path+origin. Map file is never touched. */
export function persistTestabilityPage(configPath: string, page: TestabilityPage): TestabilityReport {
  ensureWorkspace(configPath);
  const path = testabilityPath(configPath);
  return withFileLock(path, () => {
    const disk = loadTestabilityReport(resolveTestabilityReadPath(configPath));
    const next = upsertTestabilityPage(disk, page);
    writeReport(path, next);
    return next;
  });
}
