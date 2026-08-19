import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { hopsFromNavLog } from "./graph.js";
import { loadConfig } from "../persist/config.js";
import { isPresenceLive, listPresences } from "../persist/presence.js";
import { loadQualityReport, qualityReportPath } from "../persist/quality.js";
import { listReports } from "../persist/reports.js";
import { collectFindingCases, listRuns } from "../persist/runs.js";
import { loadTestabilityReport, testabilityReportPath } from "../persist/testability.js";
import { runsDir } from "../persist/workspace.js";
import type { Config } from "../schema/config.js";
import { UiLeash, UiRun, UiSnapshot, type UiRunStep } from "../schema/ui.js";
import { buildUiGraph } from "./graph.js";
import { identityFromRunId } from "./identity.js";
import {
  latestPageScreenshotUrls,
  listShotRunDirs,
  runFileUrl,
  stepShotRel,
  stepsFromNavLog,
} from "./run-detail.js";
import { originOfHref } from "../surveyor/ready.js";

function withNav(run: UiRun, dir: string): UiRun {
  const nav = join(dir, "nav.jsonl");
  if (!existsSync(nav)) return run;
  const parsed = stepsFromNavLog(readFileSync(nav, "utf8"));
  const steps: UiRunStep[] = parsed.steps.map((step) => {
    const { hops: _hops, ...rest } = step;
    const findingRel = step.finding ? `findings/fnd_${step.index}_${step.finding}/screenshot.png` : undefined;
    const findingShot =
      findingRel && existsSync(join(dir, findingRel)) ? runFileUrl(run.id, findingRel) : undefined;
    const rel = stepShotRel(dir, step.index);
    const screenshotUrl = findingShot ?? (rel ? runFileUrl(run.id, rel) : undefined);
    return { ...rest, ...(screenshotUrl ? { screenshotUrl } : {}) };
  });
  return UiRun.parse({
    ...run,
    steps,
    ...(parsed.boot
      ? {
          boot: {
            ts: parsed.boot.ts,
            hops: parsed.boot.hops.map((h) => ({
              from: h.from.split("?")[0] ?? h.from,
              to: h.to.split("?")[0] ?? h.to,
              ...(h.via ? { via: h.via } : {}),
            })),
          },
        }
      : {}),
  });
}

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

function collectUiRuns(configPath: string): UiRun[] {
  const listed = listRuns(configPath);
  const root = runsDir(configPath);
  const dirs = new Map(listed.map((r) => [r.id, r.dir]));
  const byId = new Map<string, UiRun>();
  for (const r of listed) {
    const ident = identityFromRunId(r.id);
    byId.set(
      r.id,
      withNav(
        {
          id: r.id,
          name: ident.name,
          hue: ident.hue,
          live: false,
          findingCount: r.findingCount,
        },
        r.dir,
      ),
    );
  }
  for (const p of listPresences(root)) {
    const prev = byId.get(p.id);
    if (!prev && !isPresenceLive(p)) continue;
    const dir = dirs.get(p.id) ?? join(root, p.id);
    byId.set(
      p.id,
      withNav(
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
        dir,
      ),
    );
  }
  return [...byId.values()].sort((a, b) => b.id.localeCompare(a.id));
}

export function buildUiSnapshot(configPath: string): UiSnapshot {
  const config = loadConfig(configPath);
  const testability = loadTestabilityReport(testabilityReportPath(configPath));
  const quality = loadQualityReport(qualityReportPath(configPath));
  const listed = listRuns(configPath);
  const findings = collectFindingCases(listed.map((r) => r.dir));
  const hops = listed.flatMap((r) => {
    const nav = join(r.dir, "nav.jsonl");
    if (!existsSync(nav)) return [];
    return hopsFromNavLog(readFileSync(nav, "utf8"));
  });
  const shots = latestPageScreenshotUrls(listShotRunDirs(configPath), {
    pages: config.map.pages,
    appOrigin: originOfHref(config.url),
  });
  const graph = buildUiGraph(config.map, { testability, quality, findings, hops });
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
    reports: listReports(configPath).map((r) => ({
      id: r.id,
      title: r.title,
      generatedAt: r.generatedAt,
      runIds: r.runIds,
      findingCount: r.findingCount,
    })),
  });
}
