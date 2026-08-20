import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  combineTestabilityReports,
  emptyTestabilityReport,
  foldTestabilityReport,
  TestabilityReport,
  upsertTestabilityPage,
  type TestabilityPage,
} from "../schema/testability.js";
import { withFileLock } from "./lock.js";
import { ensureWorkspace, legacyTestabilityPath, testabilityPath } from "./workspace.js";

export function testabilityReportPath(configPath: string, outDir?: string): string {
  return outDir ? join(outDir, "testability.json") : testabilityPath(configPath);
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
  return foldTestabilityReport(TestabilityReport.parse(JSON.parse(readFileSync(path, "utf8"))));
}

/** Combine `runs/<id>/testability.json`. Empty run files fall back to the workspace ledger. */
export function loadCombinedTestability(runDirs: string[], fallbackConfigPath?: string): TestabilityReport {
  const combined = combineTestabilityReports(
    runDirs.map((d) => loadTestabilityReport(join(d, "testability.json"))),
  );
  if (combined.pages.length > 0) return combined;
  if (fallbackConfigPath) return loadTestabilityReport(resolveTestabilityReadPath(fallbackConfigPath));
  return emptyTestabilityReport();
}

/** Replace the entry for this path+origin. Map file is never touched. */
export function persistTestabilityPage(
  configPath: string,
  page: TestabilityPage,
  outDir?: string,
): TestabilityReport {
  const path = testabilityReportPath(configPath, outDir);
  if (outDir) mkdirSync(outDir, { recursive: true });
  else ensureWorkspace(configPath);
  return withFileLock(path, () => {
    const disk = loadTestabilityReport(outDir ? path : resolveTestabilityReadPath(configPath));
    const next = upsertTestabilityPage(disk, page);
    writeReport(path, next);
    return next;
  });
}
