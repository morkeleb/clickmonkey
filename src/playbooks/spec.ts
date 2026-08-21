import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { bootRun } from "../executor/boot.js";
import { createExecutor } from "../executor/run.js";
import { withRun } from "../executor/session.js";
import { writeLog } from "../persist/log.js";
import { stopPresence } from "../persist/presence.js";
import { loadQualityReport, qualityReportPath } from "../persist/quality.js";
import { loadTestabilityReport, testabilityReportPath } from "../persist/testability.js";
import { specsDir } from "../persist/workspace.js";
import { extractClickmonkeyFences } from "../reports/fences.js";
import type { Config } from "../schema/config.js";
import { Finding, FindingKind, type FindingKind as FindingKindName } from "../schema/finding.js";
import type { PageModel } from "../schema/page-model.js";
import { qualityPageCounts, type QualityReport } from "../schema/quality.js";
import type { TestabilityReport } from "../schema/testability.js";
import { offlineIdsExist } from "../surveyor/merge.js";
import { replayableSteps } from "./compact.js";
import { keysFromSteps } from "./replay.js";
import { pickSeedPageId, resetToSeed } from "./seed.js";

export type SpecCheckCase = { title: string; missing: string[] };
export type SpecCheckFileResult = { file: string; cases: SpecCheckCase[] };

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function listMarkdownFiles(root: string): string[] {
  if (!isDir(root)) return [];
  const names = readdirSync(root, { recursive: true, encoding: "utf8" });
  const out: string[] = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const full = join(root, name);
    if (isFile(full)) out.push(full);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function resolveSelector(configPath: string, selector: string): string | undefined {
  if (isAbsolute(selector)) return existsSync(selector) ? selector : undefined;
  const fromSpecs = resolve(specsDir(configPath), selector);
  if (existsSync(fromSpecs)) return fromSpecs;
  const fromCwd = resolve(process.cwd(), selector);
  if (existsSync(fromCwd)) return fromCwd;
  return undefined;
}

export function listSpecFiles(configPath: string, selector?: string): string[] {
  if (!selector) return listMarkdownFiles(specsDir(configPath));
  const path = resolveSelector(configPath, selector);
  if (!path) return [];
  if (isDir(path)) return listMarkdownFiles(path);
  return [path];
}

/** Fence ids including intro; extra intro ids are ok if they are on the map. */
export function checkSpecFile(model: PageModel, filePath: string): SpecCheckFileResult {
  const markdown = readFileSync(filePath, "utf8");
  const cases: SpecCheckCase[] = [];
  try {
    const fences = extractClickmonkeyFences(markdown);
    if (fences.length === 0) {
      return { file: filePath, cases: [{ title: "(no clickmonkey fence)", missing: ["(no fence)"] }] };
    }
    for (const fence of fences) {
      const keys = [...new Set(keysFromSteps(fence.log.steps))];
      const check = offlineIdsExist(model, keys);
      cases.push({ title: fence.title, missing: check.missing });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    cases.push({ title: "(parse error)", missing: [message] });
  }
  return { file: filePath, cases };
}

function specFileLabel(file: string): string {
  const norm = file.replaceAll("\\", "/");
  const marker = "/specs/";
  const i = norm.lastIndexOf(marker);
  if (i >= 0) return `specs/${norm.slice(i + marker.length)}`;
  if (norm.startsWith("specs/")) return norm;
  return file;
}

export function formatCheckReport(results: readonly SpecCheckFileResult[]): string {
  const lines: string[] = [];
  for (const result of results) {
    const file = specFileLabel(result.file);
    for (const c of result.cases) {
      const noFence = c.missing[0] === "(no fence)";
      const status = noFence ? "NONE" : c.missing.length > 0 ? "MISS" : "OK";
      const extra =
        c.missing.length > 0 && !noFence ? `  missing: ${c.missing.join(", ")}` : noFence ? "" : "";
      lines.push(`  ${status.padEnd(4)} ${file}  ${c.title}${extra}`);
    }
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

/** visualIssue / uiIssue persist but do not fail the fence. Any other kind does. */
export const SPEC_SOFT_KINDS: ReadonlySet<FindingKindName> = new Set(["uiIssue", "visualIssue"]);

export type SpecRunCase = {
  file: string;
  title: string;
  ok: boolean;
  error?: string;
  findingCount: number;
};

export type SpecRunResult = {
  ok: boolean;
  cases: SpecRunCase[];
  logPath: string;
  mdPath: string;
  findingErrors: number;
};

/** Soft finding folders only; blocking kinds are fence results. */
export function countHarvestedFindings(runDir: string): number {
  const root = join(runDir, "findings");
  if (!existsSync(root)) return 0;
  let n = 0;
  for (const name of readdirSync(root)) {
    const jsonPath = join(root, name, "finding.json");
    if (!existsSync(jsonPath)) continue;
    try {
      const finding = Finding.parse(JSON.parse(readFileSync(jsonPath, "utf8")));
      if (!specStepFailed(finding.kind)) n += 1;
    } catch {
      // skip unreadable folders
    }
  }
  return n;
}

export function surveyorErrorCount(
  quality: QualityReport | undefined,
  testability: TestabilityReport | undefined,
  harvestedFindingCount: number,
): number {
  let n = harvestedFindingCount;
  if (quality) {
    for (const page of quality.pages) n += qualityPageCounts(page).errors;
  }
  if (testability) {
    for (const page of testability.pages) {
      for (const issue of page.issues) {
        if (issue.severity === "block") n += 1;
      }
    }
  }
  return n;
}

export function surveyorShouldFail(opts: {
  quality?: QualityReport;
  testability?: TestabilityReport;
  findingFolderCount?: number;
}): boolean {
  return surveyorErrorCount(opts.quality, opts.testability, opts.findingFolderCount ?? 0) > 0;
}

/** Exit 1 from `--fail-on-findings` only when every fence passed and extras remain. */
export function shouldFailOnFindings(ok: boolean, findingErrors: number, failOnFindings: boolean): boolean {
  return ok && failOnFindings && findingErrors > 0;
}

export function specFenceIdleError(fenceStepCount: number, replayableCount: number): string | undefined {
  if (replayableCount > 0) return undefined;
  return fenceStepCount > 0 ? "fence is only intro" : "empty fence";
}

export function formatSpecResults(opts: {
  runId: string;
  cases: readonly SpecRunCase[];
  findingErrors: number;
}): string {
  const passed = opts.cases.filter((c) => c.ok).length;
  const word = opts.findingErrors === 1 ? "issue" : "issues";
  const lines = [
    "# Spec results",
    "",
    `- **run:** ${opts.runId}`,
    `- **ok:** ${passed}/${opts.cases.length} fences`,
    `- **findings:** ${opts.findingErrors} surveyor ${word}`,
    "",
    "## Cases",
    "",
  ];
  for (const c of opts.cases) {
    const extras: string[] = [];
    if (c.findingCount > 0) extras.push(`findings ${c.findingCount}`);
    if (c.error) extras.push(c.error);
    const extra = extras.length > 0 ? ` — ${extras.join(" — ")}` : "";
    lines.push(`- ${c.ok ? "PASS" : "FAIL"} \`${specFileLabel(c.file)}\` — ${c.title}${extra}`);
  }
  return `${lines.join("\n")}\n`;
}

export function formatSpecTable(cases: readonly SpecRunCase[]): string {
  const files = cases.map((c) => specFileLabel(c.file));
  const width = files.reduce((m, f) => Math.max(m, f.length), 0);
  const lines = cases.map((c, i) => {
    const extras: string[] = [];
    if (c.findingCount > 0) extras.push(`(findings ${c.findingCount})`);
    if (c.error) extras.push(c.error);
    const extra = extras.length > 0 ? `  ${extras.join("  ")}` : "";
    return `${c.ok ? "PASS" : "FAIL"}  ${files[i]!.padEnd(width)}  ${c.title}${extra}`;
  });
  const failed = cases.filter((c) => !c.ok).length;
  const n = cases.length;
  const passedFindings = cases.filter((c) => c.ok).reduce((s, c) => s + c.findingCount, 0);
  let footer = `${n} fence${n === 1 ? "" : "s"}, ${failed} failed`;
  if (passedFindings > 0) footer += `, ${passedFindings} findings on passing cases`;
  lines.push(footer);
  return `${lines.join("\n")}\n`;
}

export function specStepFailed(kind: string | undefined): boolean {
  if (!kind) return false;
  const parsed = FindingKind.safeParse(kind);
  if (!parsed.success) return true;
  return !SPEC_SOFT_KINDS.has(parsed.data);
}

export async function runSpecs(opts: {
  config: Config;
  configPath: string;
  outDir: string;
  files: string[];
  headed?: boolean;
  timeout?: number;
  verbose?: boolean;
}): Promise<SpecRunResult> {
  const logPath = join(opts.outDir, "log.txt");
  const mdPath = join(opts.outDir, "spec-results.md");
  const runId = basename(opts.outDir);

  try {
    return await withRun({ headed: opts.headed, timeout: opts.timeout }, async (handle) => {
    const state = await bootRun(handle, opts.config, opts.outDir, {
      configPath: opts.configPath,
      verbose: opts.verbose,
      brain: "spec",
    });
    const exec = createExecutor(state);
    if (state.config.intro.length > 0) await exec.runIntro();
    const seedPageId = pickSeedPageId(state, state.pageId) ?? state.pageId;

    const cases: SpecRunCase[] = [];
    for (const file of opts.files) {
      let fences;
      try {
        fences = extractClickmonkeyFences(readFileSync(file, "utf8"));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        cases.push({ file, title: "(parse error)", ok: false, error: message, findingCount: 0 });
        continue;
      }
      if (fences.length === 0) {
        cases.push({
          file,
          title: "(no clickmonkey fence)",
          ok: false,
          error: "no clickmonkey fence",
          findingCount: 0,
        });
        continue;
      }
      for (const fence of fences) {
        const steps = replayableSteps(fence.log.steps, state.config.intro);
        let ok = true;
        let error: string | undefined;
        let findingCount = 0;
        let restoreSeed = false;
        const idle = specFenceIdleError(fence.log.steps.length, steps.length);
        if (idle) {
          ok = false;
          error = idle;
        } else {
          for (const step of steps) {
            try {
              const result = await exec.runStep(step);
              if (result.finding) findingCount += 1;
              const kind = result.finding?.kind ?? (result.bounced ? "fenceViolation" : result.view.last?.finding);
              if (specStepFailed(kind) || result.bounced) {
                ok = false;
                error = result.finding?.message ?? (result.bounced ? "left the leash" : kind);
                restoreSeed = true;
                break;
              }
            } catch (err) {
              ok = false;
              error = err instanceof Error ? err.message : String(err);
              restoreSeed = true;
              break;
            }
          }
        }
        cases.push({ file, title: fence.title, ok, ...(error ? { error } : {}), findingCount });
        if (restoreSeed) await resetToSeed(exec, state, seedPageId);
      }
    }

    const findingErrors = surveyorErrorCount(
      loadQualityReport(qualityReportPath(opts.configPath, opts.outDir)),
      loadTestabilityReport(testabilityReportPath(opts.configPath, opts.outDir)),
      countHarvestedFindings(opts.outDir),
    );
    const allOk = cases.every((c) => c.ok);
    writeLog(logPath, {
      schemaVersion: 1,
      comments: [],
      steps: state.log.steps,
      usedLocators: { ...state.usedLocators },
      result: allOk ? "passed" : "failed",
    });
    writeFileSync(mdPath, formatSpecResults({ runId, cases, findingErrors }), "utf8");
    return { ok: allOk, cases, logPath, mdPath, findingErrors };
    });
  } finally {
    stopPresence(opts.outDir);
  }
}
