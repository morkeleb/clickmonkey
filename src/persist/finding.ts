import { createHash } from "node:crypto";
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
import { redactEnvInText } from "../executor/secrets.js";
import {
  Finding,
  findingId,
  pageErrorDetail,
  severityForKind,
  type FindingKind,
  type FindingSeverity,
} from "../schema/finding.js";
import type { QualityIssue } from "../schema/quality.js";
import { ledgerPath } from "../surveyor/path-template.js";

const BRAIN_MISS_KINDS = new Set<FindingKind>(["unknownId", "unresolvedId"]);

export function shouldPersistFinding(kind: FindingKind): boolean {
  return !BRAIN_MISS_KINDS.has(kind);
}

export function writeFinding(path: string, finding: Finding): void {
  writeFileSync(path, `${redactEnvInText(JSON.stringify(finding, null, 2))}\n`, "utf8");
}

function outsideFindings(outDir: string, path: string): boolean {
  const fromFindings = relative(resolve(outDir, "findings"), resolve(path));
  return fromFindings === "" || fromFindings.startsWith("..") || isAbsolute(fromFindings);
}

function underShots(outDir: string, path: string): boolean {
  const fromShots = relative(resolve(outDir, "shots"), resolve(path));
  return fromShots !== "" && !fromShots.startsWith("..") && !isAbsolute(fromShots);
}

function unlinkIfOutsideFindings(outDir: string, path: string): void {
  if (!outsideFindings(outDir, path)) return;
  if (underShots(outDir, path)) return;
  try {
    unlinkSync(path);
  } catch {
    // leave the source if it cannot be moved
  }
}

/** Skip folders whose `kind` is no longer a finding (fence bounce, writePolicy, …). */
export function loadFindingJson(path: string): Finding | undefined {
  try {
    const parsed = Finding.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data : undefined;
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

const HTTP_WRITE = /^(POST|PUT|PATCH|DELETE)$/i;

function ledgerPathOfUrl(url: string | undefined): string {
  const raw = pathOfFindingUrl(url);
  if (!raw) return "";
  return ledgerPath(raw);
}

function httpMethodOf(message: string): string {
  const m = /^HTTP\s+\d{3}\s+([A-Z]+)/i.exec(message);
  return m?.[1]?.toUpperCase() ?? "";
}

/**
 * Canonical identity for the same product bug (no run id, step, or fill value).
 * Parametric URLs are slotted (`/vouchers/:id1`).
 */
export function findingFingerprintOf(
  f: Pick<Finding, "kind" | "message" | "url" | "pageId" | "widgetRef" | "httpStatus">,
  extra?: { url?: string; pageId?: string },
): string {
  const url = extra?.url ?? f.url;
  const pageId = extra?.pageId ?? f.pageId ?? "";
  const path = ledgerPathOfUrl(url);
  if (f.kind === "notFound") return `notFound\t${path}`;
  if (f.kind === "httpError") {
    const method = httpMethodOf(f.message);
    const status = f.httpStatus;
    const refused =
      (status === 400 || status === 409 || status === 422) && HTTP_WRITE.test(method);
    return `${refused ? "serverRefusedSubmit" : "httpError"}\t${status ?? ""}\t${path}`;
  }
  if (f.kind === "visualIssue") return visualFindingKey(f);
  if (f.kind === "pageError") {
    return `pageError\t${pageErrorDetail(f.message)}\t${pageId}\t${f.widgetRef ?? ""}`;
  }
  const msg = (f.message ?? "").replace(/\s+/g, " ").trim();
  const harness = /^(locator\.|Timeout \d+ms exceeded)/i.test(msg);
  if (harness) return `${f.kind}\t${msg.split("(")[0]!.trim()}\t${pageId}`;
  return `${f.kind}\t${msg}\t${path || pageId}\t${f.widgetRef ?? ""}`;
}

export type FindingIdentityFields = Pick<
  Finding,
  "kind" | "message" | "url" | "pageId" | "widgetRef" | "httpStatus"
> & { idempotencyKey?: string };

export type FindingIdentity = { fingerprint: string; idempotencyKey: string };

/** `ik_` + 16 hex of the canonical fingerprint. */
export function idempotencyKeyOfFingerprint(fingerprint: string): string {
  const digest = createHash("sha256").update(fingerprint).digest("hex").slice(0, 16);
  return `ik_${digest}`;
}

export function isFindingIdempotencyKey(value: string): boolean {
  return /^ik_[0-9a-f]{16}$/.test(value);
}

/** `ik_` + 16 hex of the fingerprint. Same bug → same key across runs. */
export function findingIdempotencyKey(
  f: FindingIdentityFields,
  extra?: { url?: string; pageId?: string },
): string {
  return idempotencyKeyOfFingerprint(findingFingerprintOf(f, extra));
}

export function findingIdentityOf(
  f: FindingIdentityFields,
  extra?: { url?: string; pageId?: string },
): FindingIdentity {
  const fingerprint = findingFingerprintOf(f, extra);
  return {
    fingerprint,
    idempotencyKey: f.idempotencyKey ?? idempotencyKeyOfFingerprint(fingerprint),
  };
}

function samePersistedFinding(a: Finding, b: Finding): boolean {
  const ka = a.idempotencyKey ?? findingIdempotencyKey(a);
  const kb = b.idempotencyKey ?? findingIdempotencyKey(b);
  if (ka === kb) return true;
  if (a.idempotencyKey && b.idempotencyKey) return false;
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

  finding.idempotencyKey ??= findingIdempotencyKey(finding);
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

/** Tab-strip × whose accessible name is `Close {title}` — one control, not one per title. */
export function closeTabWhere(where: string): string {
  return where.replace(/\b(button|a) "Close [^"]+"/gi, '$1 "Close tab"');
}

/**
 * Rule + scanner message + first where token.
 * Joined ` · ` examples after the first token do not mint a new finding.
 * `Close {tab title}` collapses to one Close-tab chip.
 */
export function visualFindingKey(f: Pick<Finding, "widgetRef" | "message">): string {
  const raw = (f.message ?? "").replace(/\s+/g, " ").trim();
  const idx = raw.indexOf(" — ");
  const core = (idx < 0 ? raw : raw.slice(0, idx)).trim();
  const where = idx < 0 ? "" : raw.slice(idx + 3).trim();
  const firstWhere = closeTabWhere(where.split(" · ")[0]!.trim());
  return `${f.widgetRef ?? ""}\t${core}\t${firstWhere}`;
}

export function severityForVisualIssue(issue: Pick<QualityIssue, "severity">): FindingSeverity {
  return issue.severity === "error" ? "major" : "minor";
}

export type VisualIssueScreenshot = { where: string; screenshotPath: string };

export type PersistVisualIssueCtx = {
  stepIndex: number;
  url?: string;
  pageId?: string;
  screenshotPath?: string;
  /** Focused clip PNGs. `focusVisible` never uses the step page shot. */
  issueScreenshots?: ReadonlyArray<VisualIssueScreenshot>;
  tapePath: string;
  replayLog?: string;
};

/** `@ 320px` / `@ 375px` — overflow measured at a resized viewport. */
export function overflowViewportTag(
  issue: Pick<QualityIssue, "where" | "message">,
): "320" | "375" | undefined {
  const blob = `${issue.where ?? ""} ${issue.message ?? ""}`;
  if (/@ 320px/.test(blob)) return "320";
  if (/@ 375px/.test(blob)) return "375";
  return undefined;
}

const CROPPED_RULES = new Set(["focusVisible", "clip", "targetSize", "textOcclusion"]);

function matchIssueScreenshot(
  where: string,
  shots: ReadonlyArray<VisualIssueScreenshot>,
): string | undefined {
  const want = where.replace(/\s+/g, " ").trim();
  if (!want) return undefined;
  const parts = new Set(want.split(" · ").map((s) => s.trim()).filter(Boolean));
  const hit = shots.find((s) => s.where === want || parts.has(s.where));
  return hit?.screenshotPath;
}

export function visualIssueScreenshotPath(
  issue: Pick<QualityIssue, "rule" | "where" | "message">,
  ctx: Pick<PersistVisualIssueCtx, "screenshotPath" | "issueScreenshots">,
): string | undefined {
  const shots = ctx.issueScreenshots;
  if (issue.rule === "focusVisible") {
    if (!shots?.length) return undefined;
    return matchIssueScreenshot(issue.where ?? "", shots);
  }
  const vp = issue.rule === "overflow" ? overflowViewportTag(issue) : undefined;
  if (vp && shots?.length) {
    const tag = `@ ${vp}px`;
    const hit = shots.find((s) => s.where === tag || s.where.includes(tag));
    if (hit) return hit.screenshotPath;
  }
  if (CROPPED_RULES.has(issue.rule) && shots?.length) {
    const cropped = matchIssueScreenshot(issue.where ?? "", shots);
    if (cropped) return cropped;
  }
  return ctx.screenshotPath;
}

/** File high-confidence visual issues as findings. Medium stays on the quality ledger. */
export function persistVisualIssueFindings(
  outDir: string,
  issues: QualityIssue[],
  ctx: PersistVisualIssueCtx,
): PersistFindingResult[] {
  const high = issues.filter((i) => i.source === "visual" && i.confidence === "high");
  const persistable = high.filter(
    (issue) => issue.rule !== "focusVisible" || visualIssueScreenshotPath(issue, ctx),
  );
  const results: PersistFindingResult[] = [];
  for (const [i, issue] of persistable.entries()) {
    const shot = visualIssueScreenshotPath(issue, ctx);
    const finding: Finding = {
      schemaVersion: 1,
      id: findingId(ctx.stepIndex, "visualIssue", persistable.length === 1 ? undefined : i),
      kind: "visualIssue",
      severity: severityForVisualIssue(issue),
      message: visualIssueMessage(issue),
      tapePath: ctx.tapePath,
      stepIndex: ctx.stepIndex,
      widgetRef: issue.rule,
      ...(ctx.url ? { url: ctx.url } : {}),
      ...(ctx.pageId ? { pageId: ctx.pageId } : {}),
      ...(shot ? { screenshotPath: shot } : {}),
    };
    results.push(
      persistFinding(outDir, finding, {
        screenshotPath: shot,
        replayLog: ctx.replayLog,
        keepScreenshotSource: true,
      }),
    );
  }
  return results;
}
