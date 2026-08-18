import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { compactLog } from "../playbooks/compact.js";
import { formatLog, parseLog } from "../schema/dsl.js";
import { Finding, severityForKind, type FindingSeverity } from "../schema/finding.js";
import { runsDir } from "./workspace.js";

export interface RunSummary {
  id: string;
  dir: string;
  findingCount: number;
}

export interface FindingCase {
  id: string;
  runId: string;
  runDir: string;
  finding: Finding;
  severity: FindingSeverity;
  title: string;
  description: string;
  tape: string;
  screenshotPath?: string;
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
  return readdirSync(root).filter((name) => existsSync(join(root, name, "finding.json"))).length;
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

export function collectFindingCases(runDirs: string[]): FindingCase[] {
  const cases: FindingCase[] = [];
  for (const runDir of runDirs) {
    const runId = basename(runDir);
    const root = join(runDir, "findings");
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root).sort()) {
      const folder = join(root, name);
      const jsonPath = join(folder, "finding.json");
      if (!existsSync(jsonPath)) continue;
      const finding = Finding.parse(JSON.parse(readFileSync(jsonPath, "utf8")));
      const description = existsSync(join(folder, "report.md"))
        ? readFileSync(join(folder, "report.md"), "utf8").trim()
        : finding.message;
      const tapePath = existsSync(join(folder, "replay.log"))
        ? join(folder, "replay.log")
        : existsSync(join(runDir, "log.txt"))
          ? join(runDir, "log.txt")
          : undefined;
      let tape = tapePath ? formatLog(compactLog(parseLog(readFileSync(tapePath, "utf8")))) : "";
      if (tape && !/^# bug:/m.test(tape)) {
        tape = `# bug: ${finding.message}\n\n${tape}`.trim() + "\n";
      }
      const shot = existsSync(join(folder, "screenshot.png"))
        ? join(folder, "screenshot.png")
        : finding.screenshotPath && existsSync(finding.screenshotPath)
          ? finding.screenshotPath
          : undefined;
      cases.push({
        id: finding.id,
        runId,
        runDir,
        finding,
        severity: finding.severity ?? severityForKind(finding.kind),
        title: finding.message,
        description,
        tape,
        ...(shot ? { screenshotPath: shot } : {}),
      });
    }
  }
  return cases;
}
