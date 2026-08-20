import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { lastDocument } from "../oracles/http.js";
import {
  BrokenReport,
  emptyBrokenReport,
  mergeBrokenReports,
  type BrokenEntry,
} from "../schema/broken.js";
import { withFileLock } from "./lock.js";
import { brokenPath, ensureWorkspace, legacyBrokenPath } from "./workspace.js";

export function brokenReportPath(configPath: string, outDir?: string): string {
  return outDir ? join(outDir, "broken.json") : brokenPath(configPath);
}

function resolveBrokenReadPath(configPath: string): string {
  const next = brokenPath(configPath);
  if (existsSync(next)) return next;
  const legacy = legacyBrokenPath(configPath);
  if (existsSync(legacy)) return legacy;
  return next;
}

function writeBroken(path: string, report: BrokenReport): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function loadBrokenReport(path: string): BrokenReport {
  if (!existsSync(path)) return emptyBrokenReport();
  return BrokenReport.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function loadCombinedBroken(runDirs: string[], fallbackConfigPath?: string): BrokenReport {
  const combined = runDirs.reduce(
    (acc, d) => mergeBrokenReports(acc, loadBrokenReport(join(d, "broken.json"))),
    emptyBrokenReport(),
  );
  if (combined.entries.length > 0) return combined;
  if (fallbackConfigPath) return loadBrokenReport(resolveBrokenReadPath(fallbackConfigPath));
  return emptyBrokenReport();
}

/** Union an entry into the broken-pages report. Map file is never touched. */
export function persistBrokenEntry(configPath: string, entry: BrokenEntry, outDir?: string): BrokenReport {
  const path = brokenReportPath(configPath, outDir);
  if (outDir) mkdirSync(outDir, { recursive: true });
  else ensureWorkspace(configPath);
  return withFileLock(path, () => {
    const disk = loadBrokenReport(outDir ? path : resolveBrokenReadPath(configPath));
    const next = mergeBrokenReports(disk, { schemaVersion: 1, entries: [entry] });
    writeBroken(path, next);
    return next;
  });
}

export function reportDocumentNotFound(configPath: string, page: Page, outDir?: string): BrokenReport | undefined {
  const doc = lastDocument(page);
  const href = page.url();
  const url = doc?.status === 404 ? doc.url : href;
  if (!url) return undefined;
  let path = "/";
  try {
    path = new URL(url).pathname || "/";
  } catch {
    path = url;
  }
  return persistBrokenEntry(
    configPath,
    {
      path,
      url,
      status: 404,
      foundAt: new Date().toISOString(),
      resourceType: "document",
    },
    outDir,
  );
}
