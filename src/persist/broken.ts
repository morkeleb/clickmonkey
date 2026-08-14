import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { Page } from "playwright";
import { lastDocument } from "../oracles/http.js";
import {
  BrokenReport,
  emptyBrokenReport,
  mergeBrokenReports,
  type BrokenEntry,
} from "../schema/broken.js";
import { withFileLock } from "./lock.js";

export function brokenReportPath(configPath: string): string {
  return configPath.replace(/\.json$/i, "") + ".broken.json";
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

/** Union an entry into the shared broken-pages report. Map file is never touched. */
export function persistBrokenEntry(configPath: string, entry: BrokenEntry): BrokenReport {
  const path = brokenReportPath(configPath);
  return withFileLock(path, () => {
    const disk = loadBrokenReport(path);
    const next = mergeBrokenReports(disk, { schemaVersion: 1, entries: [entry] });
    writeBroken(path, next);
    return next;
  });
}

export function reportDocumentNotFound(configPath: string, page: Page): BrokenReport | undefined {
  const doc = lastDocument(page);
  if (!doc || doc.status !== 404) return undefined;
  let path = "/";
  try {
    path = new URL(doc.url).pathname || "/";
  } catch {
    path = doc.url;
  }
  return persistBrokenEntry(configPath, {
    path,
    url: doc.url,
    status: doc.status,
    foundAt: new Date().toISOString(),
    resourceType: "document",
  });
}
