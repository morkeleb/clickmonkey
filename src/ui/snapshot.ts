import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hopsFromNavLog } from "./graph.js";
import { loadConfig } from "../persist/config.js";
import { isPresenceLive, listPresences } from "../persist/presence.js";
import { loadCombinedQuality } from "../persist/quality.js";
import { listReports } from "../persist/reports.js";
import { collectFindingCases, listRuns } from "../persist/runs.js";
import { loadCombinedTestability } from "../persist/testability.js";
import { runsDir } from "../persist/workspace.js";
import type { Config } from "../schema/config.js";
import { UiLeash, UiMapFinding, UiRun, UiSnapshot } from "../schema/ui.js";
import { buildUiGraph } from "./graph.js";
import { identityFromRunId } from "./identity.js";
import { latestPageScreenshotUrls, listShotRunDirs, runFileUrl } from "./run-detail.js";
import { originOfHref } from "../surveyor/ready.js";
import { ledgerPath } from "../surveyor/path-template.js";

function leashFromConfig(config: Config): UiLeash {
  return UiLeash.parse({
    url: config.url,
    ...(config.fence
      ? {
          fence: {
            ...(config.fence.path ? { path: config.fence.path } : {}),
            blacklist: config.fence.blacklist ?? [],
          },
        }
      : {}),
    intro: config.intro,
    skip: config.skip,
    writePolicy: config.writePolicy,
    screenshots: config.screenshots !== false,
    ...(config.brain?.model ? { brainModel: config.brain.model } : {}),
    ...(config.vision?.model ? { visionModel: config.vision.model } : {}),
  });
}

function mapFindingsOf(
  findings: ReturnType<typeof collectFindingCases>,
): ReturnType<typeof UiMapFinding.parse>[] {
  return findings.map((c) => {
    const href = c.url ?? c.finding.url;
    let path: string | undefined;
    if (href) {
      try {
        const raw = new URL(href).pathname;
        path = ledgerPath(raw === "" ? "/" : raw);
      } catch {
        path = undefined;
      }
    }
    return UiMapFinding.parse({
      id: c.id,
      runId: c.runId,
      kind: c.finding.kind,
      severity: c.severity,
      message: c.finding.message,
      ...(href ? { url: href } : {}),
      ...(c.pageId ? { pageId: c.pageId } : {}),
      ...(path ? { path } : {}),
      ...(c.screenshotPath ? { screenshotUrl: runFileUrl(c.runId, `findings/${c.id}/screenshot.png`) } : {}),
    });
  });
}

function hopsOf(listed: ReturnType<typeof listRuns>) {
  return listed.flatMap((r) => {
    const nav = join(r.dir, "nav.jsonl");
    if (!existsSync(nav)) return [];
    return hopsFromNavLog(readFileSync(nav, "utf8"));
  });
}

export type SnapshotPatch = "runs" | "quality" | "testability" | "findings";

/** Update one slice of a live snapshot without re-parsing the map. */
export function refreshUiSnapshot(
  snapshot: UiSnapshot,
  configPath: string,
  part: SnapshotPatch,
): UiSnapshot {
  if (part === "runs") return { ...snapshot, runs: collectUiRuns(configPath) };
  const listed = listRuns(configPath);
  const runDirs = listed.map((r) => r.dir);
  if (part === "quality") return { ...snapshot, quality: loadCombinedQuality(runDirs, configPath) };
  if (part === "testability") {
    return { ...snapshot, testability: loadCombinedTestability(runDirs, configPath) };
  }
  const findings = collectFindingCases(runDirs, { tapes: false });
  const hops = hopsOf(listed);
  const graph = buildUiGraph(snapshot.map, { findings, hops });
  const shots = new Map(
    snapshot.graph.nodes.flatMap((n) => (n.screenshotUrl ? [[n.pageId, n.screenshotUrl] as const] : [])),
  );
  graph.nodes = graph.nodes.map((node) => {
    if (node.kind !== "page") return node;
    const screenshotUrl = node.screenshotUrl ?? shots.get(node.pageId);
    return screenshotUrl ? { ...node, screenshotUrl } : node;
  });
  return {
    ...snapshot,
    graph,
    findings: mapFindingsOf(findings),
    runs: collectUiRuns(configPath),
    reports: listReports(configPath).map((r) => ({
      id: r.id,
      title: r.title,
      generatedAt: r.generatedAt,
      runIds: r.runIds,
      findingCount: r.findingCount,
    })),
  };
}

export function collectUiRuns(configPath: string): UiRun[] {
  const listed = listRuns(configPath);
  const root = runsDir(configPath);
  const byId = new Map<string, UiRun>();
  for (const r of listed) {
    const ident = identityFromRunId(r.id);
    byId.set(r.id, {
      id: r.id,
      name: ident.name,
      hue: ident.hue,
      live: false,
      findingCount: r.findingCount,
    });
  }
  for (const p of listPresences(root)) {
    const prev = byId.get(p.id);
    if (!prev && !isPresenceLive(p)) continue;
    byId.set(
      p.id,
      UiRun.parse({
        id: p.id,
        name: p.name,
        hue: p.hue,
        live: isPresenceLive(p),
        pageId: p.pageId,
        findingCount: prev?.findingCount ?? 0,
        ...(p.brain ? { brain: p.brain } : {}),
        ...(p.outline ? { outline: p.outline } : {}),
      }),
    );
  }
  return [...byId.values()].sort((a, b) => b.id.localeCompare(a.id));
}

export function buildUiSnapshot(configPath: string): UiSnapshot {
  const config = loadConfig(configPath, { lenientMap: true });
  const listed = listRuns(configPath);
  const runDirs = listed.map((r) => r.dir);
  const testability = loadCombinedTestability(runDirs, configPath);
  const quality = loadCombinedQuality(runDirs, configPath);
  const findings = collectFindingCases(runDirs, { tapes: false });
  const hops = hopsOf(listed);
  const shots = latestPageScreenshotUrls(listShotRunDirs(configPath), {
    pages: config.map.pages,
    appOrigin: originOfHref(config.url),
  });
  const mapFindings = mapFindingsOf(findings);
  const graph = buildUiGraph(config.map, { findings, hops });
  if (shots.size > 0) {
    graph.nodes = graph.nodes.map((node) => {
      if (node.kind !== "page") return node;
      const screenshotUrl = shots.get(node.pageId);
      return screenshotUrl ? { ...node, screenshotUrl } : node;
    });
  }
  return UiSnapshot.parse({
    schemaVersion: 1,
    leash: leashFromConfig(config),
    map: config.map,
    graph,
    testability,
    quality,
    runs: collectUiRuns(configPath),
    findings: mapFindings,
    reports: listReports(configPath).map((r) => ({
      id: r.id,
      title: r.title,
      generatedAt: r.generatedAt,
      runIds: r.runIds,
      findingCount: r.findingCount,
    })),
  });
}
