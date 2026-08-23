import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ReportMeta } from "../schema/report.js";
import { newRunId } from "./run-id.js";
import { reportsDir, workspaceDir } from "./workspace.js";

export const LEGACY_REPORT_ID = "findings";

export { reportsDir };

export function isSafeReportId(id: string): boolean {
  return Boolean(id) && id === id.replace(/[/\\]/g, "") && !id.includes("..");
}

export function reportTitle(runIds: readonly string[], findingCount: number): string {
  const findings = `${findingCount} finding${findingCount === 1 ? "" : "s"}`;
  if (runIds.length === 0) return findings;
  if (runIds.length === 1) return `${findings} · ${runIds[0]}`;
  return `${findings} · ${runIds.length} runs`;
}

export function countFindingsInMarkdown(markdown: string): number {
  const byId = markdown.match(/^- \*\*id:\*\* /gm)?.length ?? 0;
  if (byId > 0) return byId;
  const beforeQuality = markdown.split(/^## Quality\s*$/m)[0] ?? markdown;
  const findings = beforeQuality.split(/^## Findings\s*$/m)[1] ?? "";
  return (findings.match(/^### /gm) ?? []).length;
}

function parseRunsLine(markdown: string): string[] {
  const match = markdown.match(/^-\s+\*\*runs:\*\*\s+(.+)$/m);
  if (!match?.[1] || match[1].trim() === "(none)") return [];
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function writeReportFolder(
  configPath: string,
  opts: {
    url: string;
    generatedAt: string;
    runIds: string[];
    findingCount: number;
    markdown: string;
    id?: string;
  },
): { id: string; dir: string; mdPath: string; meta: ReportMeta } {
  const id = opts.id ?? newRunId();
  const meta = ReportMeta.parse({
    schemaVersion: 1,
    id,
    generatedAt: opts.generatedAt,
    url: opts.url,
    runIds: opts.runIds,
    findingCount: opts.findingCount,
    title: reportTitle(opts.runIds, opts.findingCount),
  });
  const dir = join(reportsDir(configPath), id);
  mkdirSync(dir, { recursive: true });
  const mdPath = join(dir, "findings.md");
  writeFileSync(mdPath, opts.markdown, "utf8");
  writeFileSync(join(dir, "report.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  return { id, dir, mdPath, meta };
}

export function rewriteReportMarkdown(
  configPath: string,
  id: string,
  markdown: string,
  findingCount: number,
): { meta: ReportMeta; mdPath: string } | undefined {
  if (!isSafeReportId(id) || id === LEGACY_REPORT_ID) return undefined;
  const loaded = readReport(configPath, id);
  if (!loaded) return undefined;
  const meta = ReportMeta.parse({
    ...loaded.meta,
    findingCount,
    title: reportTitle(loaded.meta.runIds, findingCount),
  });
  const dir = join(reportsDir(configPath), id);
  const mdPath = join(dir, "findings.md");
  writeFileSync(mdPath, markdown, "utf8");
  writeFileSync(join(dir, "report.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  return { meta, mdPath };
}

export function plannedReportPath(configPath: string, id: string): string {
  return join(reportsDir(configPath), id, "findings.md");
}

function metaFromJson(configPath: string, id: string): ReportMeta | undefined {
  const jsonPath = join(reportsDir(configPath), id, "report.json");
  if (!existsSync(jsonPath)) return undefined;
  try {
    return ReportMeta.parse(JSON.parse(readFileSync(jsonPath, "utf8")));
  } catch {
    return undefined;
  }
}

export function reportMarkdownPath(configPath: string, id: string): string | undefined {
  if (!isSafeReportId(id)) return undefined;
  if (id === LEGACY_REPORT_ID) {
    const legacy = join(workspaceDir(configPath), "findings.md");
    return existsSync(legacy) ? legacy : undefined;
  }
  const md = join(reportsDir(configPath), id, "findings.md");
  return existsSync(md) ? md : undefined;
}

export function readReport(
  configPath: string,
  id: string,
): { meta: ReportMeta; markdown: string } | undefined {
  const mdPath = reportMarkdownPath(configPath, id);
  if (!mdPath) return undefined;
  const markdown = readFileSync(mdPath, "utf8");
  if (id === LEGACY_REPORT_ID) {
    const runIds = parseRunsLine(markdown);
    return {
      markdown,
      meta: ReportMeta.parse({
        schemaVersion: 1,
        id,
        generatedAt: statSync(mdPath).mtime.toISOString(),
        runIds,
        findingCount: countFindingsInMarkdown(markdown),
        title: "Findings report",
      }),
    };
  }
  const fromJson = metaFromJson(configPath, id);
  const meta =
    fromJson ??
    ReportMeta.parse({
      schemaVersion: 1,
      id,
      generatedAt: statSync(mdPath).mtime.toISOString(),
      runIds: parseRunsLine(markdown),
      findingCount: 0,
      title: id,
    });
  return { meta, markdown };
}

export function listReports(configPath: string): ReportMeta[] {
  const items: ReportMeta[] = [];
  const root = reportsDir(configPath);
  if (existsSync(root)) {
    for (const name of readdirSync(root)) {
      if (!statSync(join(root, name)).isDirectory()) continue;
      if (!existsSync(join(root, name, "findings.md"))) continue;
      const fromJson = metaFromJson(configPath, name);
      if (fromJson) {
        items.push(fromJson);
        continue;
      }
      const loaded = readReport(configPath, name);
      if (loaded) items.push(loaded.meta);
    }
  }
  items.sort((a, b) => b.id.localeCompare(a.id));
  const legacy = readReport(configPath, LEGACY_REPORT_ID);
  if (legacy) items.push(legacy.meta);
  return items;
}
