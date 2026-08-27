import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { extractClickmonkeyFences } from "../reports/fences.js";
import type { Config } from "../schema/config.js";
import type { Finding, FindingKind } from "../schema/finding.js";
import type { Log } from "../schema/log.js";
import { writeLog } from "../persist/log.js";
import { replayLog, ReplayLiveValidateError } from "./replay.js";

const MECHANICAL: ReadonlySet<FindingKind> = new Set([
  "expectFailed",
  "httpError",
  "notFound",
  "pageError",
  "unresolvedId",
  "unknownId",
  "driftId",
  "locatorAmbiguous",
]);

export type CompareStatus = "fixed" | "still" | "look" | "error";

export interface ReplayCaseResult {
  title: string;
  ok: boolean;
  status: CompareStatus;
  finding?: Finding;
  error?: string;
  beforePath?: string;
  afterPath?: string;
  caseDir: string;
}

export interface ReplayReportResult {
  ok: boolean;
  sourceReport: string;
  comparisonPath: string;
  cases: ReplayCaseResult[];
}

function tapeWantsEyes(log: Log): boolean {
  return log.steps.some((s) => s.kind === "screenshot" && s.ui);
}

function classify(opts: {
  findings: Finding[];
  log: Log;
  error?: string;
}): CompareStatus {
  if (opts.error) return "error";
  const setup = opts.findings.filter(
    (f) => f.kind === "unknownId" || f.kind === "unresolvedId" || f.kind === "driftId",
  );
  if (setup.length > 0) return "error";
  const mechanical = opts.findings.filter((f) => MECHANICAL.has(f.kind));
  if (mechanical.length > 0) return "still";
  if (
    tapeWantsEyes(opts.log) ||
    opts.findings.some((f) => f.kind === "visualIssue")
  ) {
    return "look";
  }
  return "fixed";
}

function resolveReportImage(reportPath: string, href: string | undefined): string | undefined {
  if (!href || /^https?:\/\//i.test(href)) return undefined;
  const abs = resolve(dirname(reportPath), href);
  return existsSync(abs) ? abs : undefined;
}

function hrefFrom(fromFile: string, target: string | undefined): string | undefined {
  if (!target) return undefined;
  return relative(dirname(fromFile), target).split("\\").join("/");
}

export function renderComparison(result: ReplayReportResult): string {
  const counts = { still: 0, look: 0, fixed: 0, error: 0 };
  for (const c of result.cases) counts[c.status] += 1;
  const bits = (["still", "look", "fixed", "error"] as const)
    .filter((k) => counts[k] > 0)
    .map((k) => `${counts[k]} ${k.toUpperCase()}`);
  const lines = [
    "# Replay comparison",
    "",
    `Against: \`${result.sourceReport}\``,
    "",
    bits.length ? bits.join(" · ") : "no cases",
    "",
    "This is not a new run. Each case is the same tape from the findings report, replayed to see if the issue is still there.",
    "",
  ];
  for (const [i, c] of result.cases.entries()) {
    const tag = c.status.toUpperCase();
    lines.push(`## ${i + 1}. ${tag} — ${c.title}`, "");
    if (c.status === "look") {
      lines.push("Needs human eyes. Compare before (original finding) and after (this replay).", "");
    } else if (c.status === "fixed") {
      lines.push("Did not reproduce.", "");
    } else if (c.status === "still" && c.finding) {
      lines.push(`Still failing: \`${c.finding.kind}\` — ${c.finding.message}`, "");
    } else if (c.status === "error") {
      lines.push(
        `Could not replay: ${c.error ?? (c.finding ? `${c.finding.kind}: ${c.finding.message}` : "unknown")}`,
        "",
      );
    }
    const before = hrefFrom(result.comparisonPath, c.beforePath);
    const after = hrefFrom(result.comparisonPath, c.afterPath);
    if (before || after) {
      lines.push("| Before | After |", "| --- | --- |");
      lines.push(
        `| ${before ? `![before](${before})` : "_none_"} | ${after ? `![after](${after})` : "_none_"} |`,
        "",
      );
    }
  }
  return `${lines.join("\n").trim()}\n`;
}

export function formatReplayReport(result: ReplayReportResult): string {
  if (result.cases.length === 0) return "no ```clickmonkey fences in report\n";
  const counts = { still: 0, look: 0, fixed: 0, error: 0 };
  for (const c of result.cases) counts[c.status] += 1;
  const head = [
    `Compared ${result.cases.length} case${result.cases.length === 1 ? "" : "s"} against the findings report`,
    `  STILL  ${counts.still}`,
    `  LOOK   ${counts.look}   (needs eyes — before/after in comparison.md)`,
    `  FIXED  ${counts.fixed}`,
    ...(counts.error ? [`  ERROR  ${counts.error}`] : []),
    "",
  ];
  const rows = result.cases.map((c, i) => {
    const tag = c.status.toUpperCase().padEnd(5);
    const extra =
      c.status === "still" && c.finding
        ? `\n     ${c.finding.kind}: ${c.finding.message}`
        : c.status === "look"
          ? "\n     compare before/after in comparison.md"
          : c.status === "error"
            ? `\n     ${c.error ?? (c.finding ? `${c.finding.kind}: ${c.finding.message}` : "replay failed")}`
            : "";
    return `${i + 1}/${result.cases.length}  ${tag}  ${c.title}${extra}`;
  });
  return `${head.join("\n")}${rows.join("\n")}\ncomparison: ${result.comparisonPath}\n`;
}

export async function replayReport(opts: {
  markdown: string;
  reportPath: string;
  config: Config;
  configPath: string;
  outDir: string;
  headed?: boolean;
  timeout?: number;
}): Promise<ReplayReportResult> {
  const fences = extractClickmonkeyFences(opts.markdown);
  const comparisonPath = join(opts.outDir, "comparison.md");
  const cases: ReplayCaseResult[] = [];

  for (let i = 0; i < fences.length; i++) {
    const fence = fences[i]!;
    const caseDir = join(opts.outDir, `case-${String(i + 1).padStart(2, "0")}`);
    mkdirSync(caseDir, { recursive: true });
    const logPath = join(caseDir, "replay.log");
    const afterPath = join(caseDir, "after.png");
    let beforePath: string | undefined;
    try {
      writeLog(logPath, fence.log);
      const srcBefore = resolveReportImage(opts.reportPath, fence.image);
      if (srcBefore) {
        beforePath = join(caseDir, "before.png");
        copyFileSync(srcBefore, beforePath);
      }
      const result = await replayLog({
        config: opts.config,
        configPath: opts.configPath,
        logPath,
        outDir: caseDir,
        headed: opts.headed,
        timeout: opts.timeout,
        afterScreenshot: afterPath,
      });
      const status = classify({ findings: result.findings, log: fence.log });
      const after = existsSync(afterPath) ? afterPath : undefined;
      cases.push({
        title: fence.title,
        ok: status === "fixed",
        status,
        caseDir,
        ...(result.findings[0] ? { finding: result.findings[0] } : {}),
        ...(beforePath ? { beforePath } : {}),
        ...(after ? { afterPath: after } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      cases.push({
        title: fence.title,
        ok: false,
        status: "error",
        error: err instanceof ReplayLiveValidateError ? err.message : message,
        caseDir,
        ...(beforePath ? { beforePath } : {}),
      });
    }
  }

  const result: ReplayReportResult = {
    ok: cases.every((c) => c.status === "fixed" || c.status === "look"),
    sourceReport: opts.reportPath,
    comparisonPath,
    cases,
  };
  writeFileSync(comparisonPath, renderComparison(result), "utf8");
  return result;
}
