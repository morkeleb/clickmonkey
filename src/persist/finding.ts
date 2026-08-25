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
import { Finding, findingId, severityForKind, type FindingKind, type FindingSeverity } from "../schema/finding.js";
import type { QualityIssue } from "../schema/quality.js";

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

function pathOfFindingUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const path = new URL(url).pathname;
    return path === "" ? "/" : path;
  } catch {
    return undefined;
  }
}

function samePersistedFinding(a: Finding, b: Finding): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "notFound") {
    const pa = pathOfFindingUrl(a.url);
    const pb = pathOfFindingUrl(b.url);
    return Boolean(pa && pb && pa === pb);
  }
  if (a.kind === "httpError") {
    if (a.httpStatus !== b.httpStatus) return false;
    const pa = pathOfFindingUrl(a.url);
    const pb = pathOfFindingUrl(b.url);
    return Boolean(pa && pb && pa === pb);
  }
  if (a.kind === "visualIssue") {
    return visualFindingKey(a) === visualFindingKey(b);
  }
  if (a.message !== b.message) return false;
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

export type PersistFindingOpts = {
  screenshotPath?: string;
  replayLog?: string;
  /** Copy the PNG into the finding folder but leave the source in place (step shots). */
  keepScreenshotSource?: boolean;
};

export function persistFinding(
  outDir: string,
  finding: Finding,
  opts?: PersistFindingOpts,
): PersistFindingResult {
  if (!shouldPersistFinding(finding.kind)) return { finding, created: false };

  const existing = findDuplicateFinding(outDir, finding);
  if (existing) {
    const src = opts?.screenshotPath ?? finding.screenshotPath;
    if (src && existsSync(src) && !opts?.keepScreenshotSource) unlinkIfOutsideFindings(outDir, src);
    return { finding: existing, created: false };
  }

  const dir = join(outDir, "findings", finding.id);
  mkdirSync(dir, { recursive: true });

  const src = opts?.screenshotPath ?? finding.screenshotPath;
  if (src && existsSync(src)) {
    const dest = join(dir, "screenshot.png");
    if (resolve(src) !== resolve(dest)) {
      copyFileSync(src, dest);
      if (!opts?.keepScreenshotSource) unlinkIfOutsideFindings(outDir, src);
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

export function visualIssueMessage(issue: Pick<QualityIssue, "rule" | "message" | "where">): string {
  const loc = issue.where ? ` — ${issue.where}` : "";
  return `${issue.rule}: ${issue.message}${loc}`;
}

/** Rule + scanner message. Drops the ` — where` suffix so joined examples do not mint a new finding. */
export function visualFindingKey(f: Pick<Finding, "widgetRef" | "message">): string {
  const raw = (f.message ?? "").replace(/\s+/g, " ").trim();
  const core = raw.split(" — ")[0]!.trim();
  return `${f.widgetRef ?? ""}\t${core}`;
}

export function severityForVisualIssue(issue: Pick<QualityIssue, "severity">): FindingSeverity {
  return issue.severity === "error" ? "major" : "minor";
}

/** File high-confidence visual issues as findings. Medium stays on the quality ledger. */
export function persistVisualIssueFindings(
  outDir: string,
  issues: QualityIssue[],
  ctx: {
    stepIndex: number;
    url?: string;
    pageId?: string;
    screenshotPath?: string;
    tapePath: string;
    replayLog?: string;
  },
): PersistFindingResult[] {
  const high = issues.filter((i) => i.source === "visual" && i.confidence === "high");
  const results: PersistFindingResult[] = [];
  for (const [i, issue] of high.entries()) {
    const finding: Finding = {
      schemaVersion: 1,
      id: findingId(ctx.stepIndex, "visualIssue", high.length === 1 ? undefined : i),
      kind: "visualIssue",
      severity: severityForVisualIssue(issue),
      message: visualIssueMessage(issue),
      tapePath: ctx.tapePath,
      stepIndex: ctx.stepIndex,
      widgetRef: issue.rule,
      ...(ctx.url ? { url: ctx.url } : {}),
      ...(ctx.pageId ? { pageId: ctx.pageId } : {}),
      ...(ctx.screenshotPath ? { screenshotPath: ctx.screenshotPath } : {}),
    };
    results.push(
      persistFinding(outDir, finding, {
        screenshotPath: ctx.screenshotPath,
        replayLog: ctx.replayLog,
        keepScreenshotSource: true,
      }),
    );
  }
  return results;
}
