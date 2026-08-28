import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { compactLog, hoppedStepIndexes } from "../playbooks/compact.js";
import { findingHitOf, type FindingHit } from "../reports/check.js";
import { formatLog, parseLog } from "../schema/dsl.js";
import { type Finding, severityForKind, type FindingSeverity } from "../schema/finding.js";
import { loadFindingJson } from "./finding.js";
import { runsDir } from "./workspace.js";

export interface RunSummary {
  id: string;
  dir: string;
  findingCount: number;
}

/** Persisted finding plus the Check class and where this hit was. */
export type FindingCase = FindingHit & {
  id: string;
  runId: string;
  runDir: string;
  finding: Finding;
  severity: FindingSeverity;
  title: string;
  description: string;
  tape: string;
};

type NavEv = { type?: unknown; pageId?: unknown; from?: unknown; to?: unknown; url?: unknown };

function compactCtx(pageId?: string, url?: string): { pageId?: string; url?: string } {
  return { ...(pageId ? { pageId } : {}), ...(url ? { url } : {}) };
}

function readNavEvents(runDir: string): NavEv[] {
  const nav = join(runDir, "nav.jsonl");
  if (!existsSync(nav)) return [];
  const out: NavEv[] = [];
  for (const raw of readFileSync(nav, "utf8").split(/\r?\n/)) {
    if (!raw.trim()) continue;
    try {
      out.push(JSON.parse(raw) as NavEv);
    } catch {
      continue;
    }
  }
  return out;
}

function contextFromEvents(events: readonly NavEv[], stepIndex: number): { pageId?: string; url?: string } {
  let n = -1;
  let pageId: string | undefined;
  let url: string | undefined;
  let inTarget = false;
  let sawHop = false;
  for (const ev of events) {
    if (ev.type === "nav" && typeof ev.to === "string") {
      if (inTarget && (typeof ev.from !== "string" || ev.from !== ev.to)) sawHop = true;
      url = ev.to;
    }
    if (ev.type === "land") {
      if (typeof ev.url === "string") {
        if (inTarget) sawHop = true;
        url = ev.url;
      }
      if (typeof ev.pageId === "string" && ev.pageId) pageId = ev.pageId;
    }
    if (ev.type === "step") {
      if (inTarget) {
        if (sawHop && typeof ev.pageId === "string" && ev.pageId) pageId = ev.pageId;
        break;
      }
      n += 1;
      if (typeof ev.pageId === "string" && ev.pageId) pageId = ev.pageId;
      if (n === stepIndex) inTarget = true;
      continue;
    }
    if (ev.type === "stepDone" && inTarget && n === stepIndex) {
      // keep scanning for a following land / next step pageId
      continue;
    }
  }
  return compactCtx(pageId, url);
}

/** Page/url after each step. Parses `nav.jsonl` once. */
export function contextsByStep(runDir: string): Map<number, { pageId?: string; url?: string }> {
  const events = readNavEvents(runDir);
  const out = new Map<number, { pageId?: string; url?: string }>();
  let steps = 0;
  for (const ev of events) {
    if (ev.type === "step") steps += 1;
  }
  for (let i = 0; i < steps; i++) out.set(i, contextFromEvents(events, i));
  return out;
}

export function contextAtStep(runDir: string, stepIndex: number): { pageId?: string; url?: string } {
  return contextFromEvents(readNavEvents(runDir), stepIndex);
}

function collectRunRoot(root: string, byId: Map<string, RunSummary>): void {
  if (!existsSync(root)) return;
  for (const name of readdirSync(root)) {
    if (byId.has(name)) continue;
    const dir = join(root, name);
    if (!statSync(dir).isDirectory()) continue;
    const findingCount = countFindings(dir);
    if (findingCount === 0 && !existsSync(join(dir, "log.txt"))) continue;
    byId.set(name, { id: name, dir, findingCount });
  }
}

export function listRuns(configPath: string): RunSummary[] {
  const byId = new Map<string, RunSummary>();
  collectRunRoot(runsDir(configPath), byId);
  collectRunRoot(join(dirname(configPath), "runs"), byId);
  return [...byId.values()].sort((a, b) => b.id.localeCompare(a.id));
}

export function countFindings(runDir: string): number {
  const root = join(runDir, "findings");
  if (!existsSync(root)) return 0;
  return readdirSync(root).filter((name) => Boolean(loadFindingJson(join(root, name, "finding.json")))).length;
}

export function resolveRunDirs(configPath: string, selectors: string[]): string[] {
  const known = listRuns(configPath);
  const byId = new Map(known.map((r) => [r.id, r.dir]));
  const dirs: string[] = [];
  for (const sel of selectors) {
    const trimmed = sel.trim();
    if (!trimmed) continue;
    if (byId.has(trimmed)) {
      dirs.push(byId.get(trimmed)!);
      continue;
    }
    if (existsSync(trimmed) && statSync(trimmed).isDirectory()) {
      dirs.push(trimmed);
      continue;
    }
    throw new Error(`unknown run: ${trimmed}`);
  }
  return dirs;
}

export function collectFindingCases(
  runDirs: string[],
  opts?: { tapes?: boolean },
): FindingCase[] {
  const wantTapes = opts?.tapes !== false;
  const cases: FindingCase[] = [];
  for (const runDir of runDirs) {
    const runId = basename(runDir);
    const root = join(runDir, "findings");
    if (!existsSync(root)) continue;
    const ctxByStep = contextsByStep(runDir);
    const navPath = join(runDir, "nav.jsonl");
    let hopped: Set<number> | undefined;
    let hoppedReady = false;
    const hoppedIndexes = (): Set<number> | undefined => {
      if (hoppedReady) return hopped;
      hoppedReady = true;
      if (existsSync(navPath)) hopped = hoppedStepIndexes(readFileSync(navPath, "utf8"));
      return hopped;
    };
    for (const name of readdirSync(root).sort()) {
      const folder = join(root, name);
      const jsonPath = join(folder, "finding.json");
      const finding = loadFindingJson(jsonPath);
      if (!finding) continue;
      const description =
        wantTapes && existsSync(join(folder, "report.md"))
          ? readFileSync(join(folder, "report.md"), "utf8").trim()
          : finding.message;
      let tape = "";
      if (wantTapes) {
        const tapePath = existsSync(join(folder, "replay.log"))
          ? join(folder, "replay.log")
          : existsSync(join(runDir, "log.txt"))
            ? join(runDir, "log.txt")
            : undefined;
        if (tapePath) {
          const raw = readFileSync(tapePath, "utf8");
          try {
            const hoppedIdx =
              basename(tapePath) === "log.txt" ? hoppedIndexes() : undefined;
            tape = formatLog(compactLog(parseLog(raw), hoppedIdx ? { hopped: hoppedIdx } : undefined));
          } catch {
            tape = raw;
          }
        }
        if (tape && !/^# bug:/m.test(tape)) {
          tape = `# bug: ${finding.message}\n\n${tape}`.trim() + "\n";
        }
      }
      const shot = existsSync(join(folder, "screenshot.png"))
        ? join(folder, "screenshot.png")
        : finding.screenshotPath && existsSync(finding.screenshotPath)
          ? finding.screenshotPath
          : undefined;
      const ctx = ctxByStep.get(finding.stepIndex) ?? {};
      const hit = findingHitOf(finding, {
        pageId: finding.pageId ?? ctx.pageId,
        url: finding.url ?? ctx.url,
        screenshotPath: shot,
      });
      cases.push({
        ...hit,
        id: finding.id,
        runId,
        runDir,
        finding,
        severity: finding.severity ?? severityForKind(finding.kind),
        title: finding.message,
        description,
        tape,
      });
    }
  }
  return cases;
}
