import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  combineQualityReports,
  emptyQualityReport,
  foldQualityReport,
  mergeQualityIssues,
  mergeRuntimeEvents,
  mergeTitleInstances,
  QualityReport,
  sameLedgerPage,
  upsertQualityPage,
  type QualityIssue,
  type QualityPage,
  type QualityRuntimeEvent,
} from "../schema/quality.js";
import { ledgerPath } from "../surveyor/path-template.js";
import { applyDuplicateTitles } from "../surveyor/seo.js";
import { withFileLock } from "./lock.js";
import { ensureWorkspace, qualityPath } from "./workspace.js";

export function qualityReportPath(configPath: string, outDir?: string): string {
  return outDir ? join(outDir, "quality.json") : qualityPath(configPath);
}

function resolveQualityWritePath(configPath: string, outDir?: string): string {
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    return join(outDir, "quality.json");
  }
  ensureWorkspace(configPath);
  return qualityPath(configPath);
}

/** Combine `runs/<id>/quality.json`. Empty run files fall back to the workspace ledger. */
export function loadCombinedQuality(runDirs: string[], fallbackConfigPath?: string): QualityReport {
  const combined = combineQualityReports(runDirs.map((d) => loadQualityReport(join(d, "quality.json"))));
  const sourced =
    combined.pages.length > 0
      ? combined
      : fallbackConfigPath
        ? loadQualityReport(qualityPath(fallbackConfigPath))
        : emptyQualityReport();
  return applyDuplicateTitles(sourced);
}

function writeReport(path: string, report: QualityReport): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function loadQualityReport(path: string): QualityReport {
  if (!existsSync(path)) return emptyQualityReport();
  return foldQualityReport(QualityReport.parse(JSON.parse(readFileSync(path, "utf8"))));
}

function findPage(
  report: QualityReport,
  key: { path: string; origin?: string },
): QualityPage | undefined {
  return report.pages.find((p) => sameLedgerPage(p, key));
}

/** Replace html/a11y for this path+origin; keep existing runtime and visual. */
export function persistQualitySnapshot(
  configPath: string,
  page: Omit<QualityPage, "runtime" | "visual" | "visualHash" | "seo"> & {
    runtime?: QualityRuntimeEvent[];
    seo?: QualityIssue[];
    titleInstance?: { path: string; title: string };
  },
  outDir?: string,
): QualityReport {
  const path = resolveQualityWritePath(configPath, outDir);
  return withFileLock(path, () => {
    const disk = loadQualityReport(path);
    const key = { path: ledgerPath(page.path), ...(page.origin ? { origin: page.origin } : {}) };
    const prev = findPage(disk, key);
    const titleInstances = mergeTitleInstances(
      prev?.titleInstances,
      page.titleInstance ? [page.titleInstance] : page.titleInstances,
    );
    const nextPage: QualityPage = {
      path: key.path,
      foundAt: page.foundAt,
      html: page.html,
      a11y: page.a11y,
      seo: page.seo ?? [],
      visual: prev?.visual ?? [],
      runtime: page.runtime ?? prev?.runtime ?? [],
      ...(key.origin ? { origin: key.origin } : {}),
      ...(page.htmlHash ? { htmlHash: page.htmlHash } : {}),
      ...(prev?.visualHash ? { visualHash: prev.visualHash } : {}),
      ...(page.title?.trim()
        ? { title: page.title.replace(/\s+/g, " ").trim() }
        : prev?.title
          ? { title: prev.title }
          : {}),
      ...(titleInstances ? { titleInstances } : {}),
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
  outDir?: string,
): QualityReport {
  const path = resolveQualityWritePath(configPath, outDir);
  const now = event.lastSeen;
  return withFileLock(path, () => {
    const disk = loadQualityReport(path);
    const foldedKey = { path: ledgerPath(key.path), ...(key.origin ? { origin: key.origin } : {}) };
    const prev = findPage(disk, foldedKey);
    const nextPage: QualityPage = {
      path: foldedKey.path,
      foundAt: prev?.foundAt ?? now,
      html: prev?.html ?? [],
      a11y: prev?.a11y ?? [],
      seo: prev?.seo ?? [],
      visual: prev?.visual ?? [],
      runtime: mergeRuntimeEvents(prev?.runtime ?? [], [event]),
      ...(foldedKey.origin ? { origin: foldedKey.origin } : {}),
      ...(prev?.htmlHash ? { htmlHash: prev.htmlHash } : {}),
      ...(prev?.visualHash ? { visualHash: prev.visualHash } : {}),
      ...(prev?.title ? { title: prev.title } : {}),
      ...(prev?.titleInstances ? { titleInstances: prev.titleInstances } : {}),
    };
    const next = upsertQualityPage(disk, nextPage);
    writeReport(path, next);
    return next;
  });
}

export function lastQualityPage(
  configPath: string,
  key: { path: string; origin?: string },
  outDir?: string,
): QualityPage | undefined {
  const path = qualityReportPath(configPath, outDir);
  if (!existsSync(path)) return undefined;
  return findPage(loadQualityReport(path), key);
}

export function lastHtmlHash(
  configPath: string,
  key: { path: string; origin?: string },
): string | undefined {
  return lastQualityPage(configPath, key)?.htmlHash;
}

/** Union visual issues for this path+origin; keep html, a11y, runtime, htmlHash. */
export function persistQualityVisual(
  configPath: string,
  page: {
    path: string;
    origin?: string;
    foundAt: string;
    visual: QualityIssue[];
    visualHash: string;
  },
  outDir?: string,
  opts?: { /** Drop prior DOM hits; keep VLM-only rows (layout snapshot). */ replaceDom?: boolean },
): QualityReport {
  const path = resolveQualityWritePath(configPath, outDir);
  return withFileLock(path, () => {
    const disk = loadQualityReport(path);
    const key = { path: ledgerPath(page.path), ...(page.origin ? { origin: page.origin } : {}) };
    const prev = findPage(disk, key);
    const prior = opts?.replaceDom
      ? (prev?.visual ?? []).filter(
          (i) => i.via === "vlm" || (i.via !== "dom" && (i.rule === "contrast" || i.rule === "align" || i.rule === "other")),
        )
      : (prev?.visual ?? []);
    const nextPage: QualityPage = {
      path: key.path,
      foundAt: page.foundAt,
      html: prev?.html ?? [],
      a11y: prev?.a11y ?? [],
      seo: prev?.seo ?? [],
      visual: mergeQualityIssues([...prior, ...page.visual]),
      runtime: prev?.runtime ?? [],
      visualHash: page.visualHash,
      ...(key.origin ? { origin: key.origin } : {}),
      ...(prev?.htmlHash ? { htmlHash: prev.htmlHash } : {}),
      ...(prev?.title ? { title: prev.title } : {}),
      ...(prev?.titleInstances ? { titleInstances: prev.titleInstances } : {}),
    };
    const next = upsertQualityPage(disk, nextPage);
    writeReport(path, next);
    return next;
  });
}

export function lastVisualHash(
  configPath: string,
  key: { path: string; origin?: string },
  outDir?: string,
): string | undefined {
  const path = qualityReportPath(configPath, outDir);
  if (!existsSync(path)) return undefined;
  return findPage(loadQualityReport(path), key)?.visualHash;
}
