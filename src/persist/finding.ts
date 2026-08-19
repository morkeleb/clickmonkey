import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { cannedReport } from "../reports/canned.js";
import { Finding, severityForKind, type FindingKind } from "../schema/finding.js";

const BRAIN_MISS_KINDS = new Set<FindingKind>(["unknownId", "unresolvedId"]);

export function shouldPersistFinding(kind: FindingKind): boolean {
  return !BRAIN_MISS_KINDS.has(kind);
}

export function writeFinding(path: string, finding: Finding): void {
  writeFileSync(path, `${JSON.stringify(finding, null, 2)}\n`, "utf8");
}

function outsideFindings(outDir: string, path: string): boolean {
  const fromFindings = relative(resolve(outDir, "findings"), resolve(path));
  return fromFindings === "" || fromFindings.startsWith("..") || isAbsolute(fromFindings);
}

function unlinkIfOutsideFindings(outDir: string, path: string): void {
  if (!outsideFindings(outDir, path)) return;
  try {
    unlinkSync(path);
  } catch {
    // leave the source if it cannot be moved
  }
}

function loadFindingJson(path: string): Finding | undefined {
  try {
    return Finding.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return undefined;
  }
}

function samePersistedFinding(a: Finding, b: Finding): boolean {
  if (a.kind !== b.kind || a.message !== b.message) return false;
  if (a.url && b.url && a.url !== b.url) return false;
  if (a.widgetRef && b.widgetRef && a.widgetRef !== b.widgetRef) return false;
  return true;
}

function findDuplicateFinding(outDir: string, finding: Finding): Finding | undefined {
  const root = join(outDir, "findings");
  if (!existsSync(root)) return undefined;
  for (const name of readdirSync(root).sort()) {
    const parsed = loadFindingJson(join(root, name, "finding.json"));
    if (parsed && samePersistedFinding(parsed, finding)) return parsed;
  }
  return undefined;
}

export type PersistFindingResult = { finding: Finding; created: boolean };

export function persistFinding(
  outDir: string,
  finding: Finding,
  opts?: { screenshotPath?: string; replayLog?: string },
): PersistFindingResult {
  if (!shouldPersistFinding(finding.kind)) return { finding, created: false };

  const existing = findDuplicateFinding(outDir, finding);
  if (existing) {
    const src = opts?.screenshotPath ?? finding.screenshotPath;
    if (src && existsSync(src)) unlinkIfOutsideFindings(outDir, src);
    return { finding: existing, created: false };
  }

  const dir = join(outDir, "findings", finding.id);
  mkdirSync(dir, { recursive: true });

  const src = opts?.screenshotPath ?? finding.screenshotPath;
  if (src && existsSync(src)) {
    const dest = join(dir, "screenshot.png");
    if (resolve(src) !== resolve(dest)) {
      copyFileSync(src, dest);
      unlinkIfOutsideFindings(outDir, src);
    }
    finding.screenshotPath = dest;
  } else {
    delete finding.screenshotPath;
  }

  if (opts?.replayLog !== undefined) {
    const replayPath = join(dir, "replay.log");
    writeFileSync(replayPath, opts.replayLog, "utf8");
    finding.tapePath = replayPath;
  }

  finding.severity ??= severityForKind(finding.kind);

  writeFinding(join(dir, "finding.json"), finding);
  writeFileSync(join(dir, "report.md"), cannedReport(finding), "utf8");
  return { finding, created: true };
}

export function appendFindingReport(outDir: string, findingId: string, extraMarkdown: string): void {
  const path = join(outDir, "findings", findingId, "report.md");
  const extra = extraMarkdown.trim();
  if (!extra || !existsSync(path)) return;
  appendFileSync(path, extra.endsWith("\n") ? `\n${extra}` : `\n${extra}\n`, "utf8");
}
