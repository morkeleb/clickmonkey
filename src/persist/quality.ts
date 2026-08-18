import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import {
  emptyQualityReport,
  mergeRuntimeEvents,
  QualityReport,
  sameLedgerPage,
  upsertQualityPage,
  type QualityPage,
  type QualityRuntimeEvent,
} from "../schema/quality.js";
import { withFileLock } from "./lock.js";
import { ensureWorkspace, qualityPath } from "./workspace.js";

export function qualityReportPath(configPath: string): string {
  return qualityPath(configPath);
}

function writeReport(path: string, report: QualityReport): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function loadQualityReport(path: string): QualityReport {
  if (!existsSync(path)) return emptyQualityReport();
  return QualityReport.parse(JSON.parse(readFileSync(path, "utf8")));
}

function findPage(
  report: QualityReport,
  key: { path: string; origin?: string },
): QualityPage | undefined {
  return report.pages.find((p) => sameLedgerPage(p, key));
}

/** Replace html/a11y for this path+origin; keep existing runtime events. */
export function persistQualitySnapshot(
  configPath: string,
  page: Omit<QualityPage, "runtime"> & { runtime?: QualityRuntimeEvent[] },
): QualityReport {
  ensureWorkspace(configPath);
  const path = qualityPath(configPath);
  return withFileLock(path, () => {
    const disk = loadQualityReport(path);
    const prev = findPage(disk, page);
    const nextPage: QualityPage = {
      path: page.path,
      foundAt: page.foundAt,
      html: page.html,
      a11y: page.a11y,
      runtime: page.runtime ?? prev?.runtime ?? [],
      ...(page.origin ? { origin: page.origin } : {}),
      ...(page.htmlHash ? { htmlHash: page.htmlHash } : {}),
    };
    const next = upsertQualityPage(disk, nextPage);
    writeReport(path, next);
    return next;
  });
}

export function persistQualityRuntime(
  configPath: string,
  key: { path: string; origin?: string },
  event: QualityRuntimeEvent,
): QualityReport {
  ensureWorkspace(configPath);
  const path = qualityPath(configPath);
  const now = event.lastSeen;
  return withFileLock(path, () => {
    const disk = loadQualityReport(path);
    const prev = findPage(disk, key);
    const nextPage: QualityPage = {
      path: key.path,
      foundAt: prev?.foundAt ?? now,
      html: prev?.html ?? [],
      a11y: prev?.a11y ?? [],
      runtime: mergeRuntimeEvents(prev?.runtime ?? [], [event]),
      ...(key.origin ? { origin: key.origin } : {}),
      ...(prev?.htmlHash ? { htmlHash: prev.htmlHash } : {}),
    };
    const next = upsertQualityPage(disk, nextPage);
    writeReport(path, next);
    return next;
  });
}

export function lastHtmlHash(
  configPath: string,
  key: { path: string; origin?: string },
): string | undefined {
  const path = qualityPath(configPath);
  if (!existsSync(path)) return undefined;
  return findPage(loadQualityReport(path), key)?.htmlHash;
}
