import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { Finding, severityForKind } from "../schema/finding.js";
import {
  UiRunDetail,
  UiRunFinding,
  UiRunHop,
  UiRunStep,
  type UiRunHop as Hop,
  type UiRunStep as Step,
} from "../schema/ui.js";
import { identityFromRunId } from "./identity.js";
import { isPresenceLive, loadPresence, presencePath } from "../persist/presence.js";
import { countFindings, listRuns } from "../persist/runs.js";
import { runsDir } from "../persist/workspace.js";
import { findPageForHref } from "../surveyor/ready.js";
import { slug } from "../surveyor/ids.js";

export function runFileUrl(runId: string, rel: string): string {
  return `/files/runs/${runId}/${rel.split("\\").join("/")}`;
}

const STEP_SHOT = /^step-(\d+)/;

/** One readdir of `shots/` — callers must not call `stepShotRel` in a loop. */
export function shotRelsByIndex(runDir: string): Map<number, string> {
  const shotsDir = join(runDir, "shots");
  const out = new Map<number, string>();
  if (!existsSync(shotsDir)) return out;
  let names: string[];
  try {
    names = readdirSync(shotsDir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name.endsWith(".png")) continue;
    const m = STEP_SHOT.exec(name);
    if (!m) continue;
    const index = Number(m[1]);
    if (!Number.isInteger(index) || index < 0) continue;
    const exact = `step-${String(index).padStart(3, "0")}.png`;
    const prev = out.get(index);
    if (!prev || name === exact) out.set(index, `shots/${name}`);
  }
  return out;
}

export function stepShotRel(runDir: string, index: number, rels?: Map<number, string>): string | undefined {
  return (rels ?? shotRelsByIndex(runDir)).get(index);
}

/** Live walks often have nav.jsonl + shots before log.txt exists, so listRuns misses them. */
export function listShotRunDirs(configPath: string): Array<{ id: string; dir: string }> {
  const byId = new Map<string, { id: string; dir: string }>();
  const addRoot = (root: string) => {
    if (!existsSync(root)) return;
    for (const name of readdirSync(root)) {
      if (byId.has(name)) continue;
      const dir = join(root, name);
      if (!statSync(dir).isDirectory()) continue;
      if (!existsSync(join(dir, "nav.jsonl"))) continue;
      byId.set(name, { id: name, dir });
    }
  };
  addRoot(runsDir(configPath));
  addRoot(join(dirname(configPath), "runs"));
  return [...byId.values()];
}

export type ShotPageRef = { id: string; path: string; origin?: string };

/**
 * Page the PNG belongs to: after the step, not where the click started.
 * A hop from home to a run detail must not become home's still.
 * A notFound shot is not a portrait of any map page.
 */
export function shotPageId(
  step: Pick<Step, "pageId" | "atPageId" | "hops" | "finding">,
  pages?: readonly ShotPageRef[],
  appOrigin?: string,
): string | undefined {
  if (step.finding === "notFound") return undefined;
  return stillWrittenFor(step, pages, appOrigin);
}

function stillWrittenFor(
  step: Pick<Step, "pageId" | "atPageId" | "hops">,
  pages?: readonly ShotPageRef[],
  appOrigin?: string,
): string | undefined {
  const hops = step.hops ?? [];
  if (hops.length > 0 && pages && appOrigin) {
    const to = hops[hops.length - 1]?.to;
    if (to) return findPageForHref(pages, to, appOrigin)?.id;
  }
  if (step.atPageId) return step.atPageId;
  return step.pageId;
}

/** Last visit that wrote this page's still was a 404 — do not use pages/{id}.png from this run. */
function pageStillPoisoned(
  steps: readonly Step[],
  pageId: string,
  pages?: readonly ShotPageRef[],
  appOrigin?: string,
): boolean {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i]!;
    if (stillWrittenFor(step, pages, appOrigin) !== pageId) continue;
    return step.finding === "notFound";
  }
  return false;
}

function pageStillRel(runDir: string, pageId: string): string | undefined {
  const rel = `shots/pages/${slug(pageId)}.png`;
  return existsSync(join(runDir, rel)) ? rel : undefined;
}

/** Newest still of each page. Prefer shots/pages/{pageId}.png; else infer from the step's landing page. */
export function latestPageScreenshotUrls(
  listed: Array<{ id: string; dir: string }>,
  opts?: { pages?: readonly ShotPageRef[]; appOrigin?: string },
): Map<string, string> {
  const out = new Map<string, string>();
  const runs = [...listed].sort((a, b) => b.id.localeCompare(a.id));
  for (const run of runs) {
    const nav = join(run.dir, "nav.jsonl");
    if (!existsSync(nav)) continue;
    const { steps } = stepsFromNavLog(readFileSync(nav, "utf8"));
    const rels = shotRelsByIndex(run.dir);
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i]!;
      const pageId = shotPageId(step, opts?.pages, opts?.appOrigin);
      if (!pageId || out.has(pageId)) continue;
      const rel = rels.get(step.index) ?? pageStillRel(run.dir, pageId);
      if (rel) out.set(pageId, runFileUrl(run.id, rel));
    }
  }
  for (const run of runs) {
    const pagesDir = join(run.dir, "shots", "pages");
    if (!existsSync(pagesDir)) continue;
    const nav = join(run.dir, "nav.jsonl");
    const steps = existsSync(nav) ? stepsFromNavLog(readFileSync(nav, "utf8")).steps : [];
    for (const name of readdirSync(pagesDir)) {
      if (!name.endsWith(".png")) continue;
      const pageId = name.slice(0, -4);
      if (!pageId || out.has(pageId)) continue;
      if (pageStillPoisoned(steps, pageId, opts?.pages, opts?.appOrigin)) continue;
      out.set(pageId, runFileUrl(run.id, `shots/pages/${name}`));
    }
  }
  return out;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function hopOf(raw: Record<string, unknown>): Hop | undefined {
  const from = asString(raw.from);
  const to = asString(raw.to);
  if (!from || !to) return undefined;
  const status = asNumber(raw.status);
  const via = asString(raw.via);
  return UiRunHop.parse({
    from,
    to,
    ...(via ? { via } : {}),
    ...(status !== undefined ? { status } : {}),
  });
}

export function stepsFromNavLog(text: string): { boot?: { ts: string; hops: Hop[] }; steps: Step[] } {
  const steps: Step[] = [];
  let pending: { line?: string; note?: string; good?: string; sight?: string } | undefined;
  let current: {
    ts: string;
    line: string;
    pageId?: string;
    phase?: string;
    hops: Hop[];
    note?: string;
    good?: string;
    sight?: string;
  } | undefined;
  const prelude: Hop[] = [];
  let bootTs: string | undefined;

  const flushOpen = (): void => {
    if (!current) return;
    steps.push(
      UiRunStep.parse({
        index: steps.length,
        ts: current.ts,
        line: current.line,
        hops: current.hops,
        ...(current.pageId ? { pageId: current.pageId } : {}),
        ...(current.phase ? { phase: current.phase } : {}),
        ...(current.note ? { note: current.note } : {}),
        ...(current.good ? { good: current.good } : {}),
        ...(current.sight ? { sight: current.sight } : {}),
      }),
    );
    current = undefined;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(rawLine) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = asString(ev.type);
    const ts = asString(ev.ts) ?? new Date().toISOString();
    if (type === "brain") {
      const note = asString(ev.note);
      const good = asString(ev.good);
      if (note || good) {
        pending = { line: asString(ev.line), ...(note ? { note } : {}), ...(good ? { good } : {}) };
      }
      continue;
    }
    if (type === "sight") {
      const sight = asString(ev.sight);
      if (!sight) continue;
      const line = asString(ev.line);
      if (current && (!line || current.line === line)) {
        current.sight = sight;
        continue;
      }
      const last = !current ? steps[steps.length - 1] : undefined;
      if (last && (!line || last.line === line)) {
        steps[steps.length - 1] = UiRunStep.parse({ ...last, sight });
        continue;
      }
      pending = { line, sight };
      continue;
    }
    if (type === "land") {
      pending = undefined;
      continue;
    }
    if (type === "step") {
      flushOpen();
      const line = asString(ev.line);
      if (!line) {
        pending = undefined;
        continue;
      }
      const take = pending && (!pending.line || pending.line === line);
      current = {
        ts,
        line,
        hops: [],
        ...(asString(ev.pageId) ? { pageId: asString(ev.pageId) } : {}),
        ...(asString(ev.phase) ? { phase: asString(ev.phase) } : {}),
        ...(take && pending?.note ? { note: pending.note } : {}),
        ...(take && pending?.good ? { good: pending.good } : {}),
        ...(take && pending?.sight ? { sight: pending.sight } : {}),
      };
      pending = undefined;
      continue;
    }
    if (type === "stepDone") {
      if (!current) continue;
      const hops = current.hops;
      const atPageId = asString(ev.pageId);
      steps.push(
        UiRunStep.parse({
          index: steps.length,
          ts: current.ts,
          line: current.line,
          ...(current.pageId ? { pageId: current.pageId } : {}),
          ...(atPageId ? { atPageId } : {}),
          ...(current.phase ? { phase: current.phase } : {}),
          ...(typeof ev.ok === "boolean" ? { ok: ev.ok } : {}),
          ...(asNumber(ev.ms) !== undefined ? { ms: asNumber(ev.ms) } : {}),
          ...(asString(ev.finding) ? { finding: asString(ev.finding) } : {}),
          ...(hops.length > 0 ? { hops } : {}),
          ...(current.note ? { note: current.note } : {}),
          ...(current.good ? { good: current.good } : {}),
          ...(current.sight ? { sight: current.sight } : {}),
        }),
      );
      current = undefined;
      continue;
    }
    if (type === "nav") {
      const hop = hopOf(ev);
      if (!hop) continue;
      if (current) current.hops.push(hop);
      else {
        prelude.push(hop);
        bootTs ??= ts;
      }
    }
  }
  flushOpen();
  return {
    steps,
    ...(prelude.length > 0 && bootTs ? { boot: { ts: bootTs, hops: prelude } } : {}),
  };
}

function collectFindings(runDir: string, runId: string): UiRunFinding[] {
  const root = join(runDir, "findings");
  if (!existsSync(root)) return [];
  const out: UiRunFinding[] = [];
  for (const name of readdirSync(root).sort()) {
    const jsonPath = join(root, name, "finding.json");
    if (!existsSync(jsonPath)) continue;
    let finding: Finding;
    try {
      finding = Finding.parse(JSON.parse(readFileSync(jsonPath, "utf8")));
    } catch {
      continue;
    }
    const shot = join(root, name, "screenshot.png");
    out.push(
      UiRunFinding.parse({
        id: finding.id,
        kind: finding.kind,
        severity: finding.severity ?? severityForKind(finding.kind),
        message: finding.message,
        stepIndex: finding.stepIndex,
        ...(finding.url ? { url: finding.url } : {}),
        ...(finding.pageId ? { pageId: finding.pageId } : {}),
        ...(finding.widgetRef ? { widgetRef: finding.widgetRef } : {}),
        ...(existsSync(shot) ? { screenshotUrl: runFileUrl(runId, `findings/${name}/screenshot.png`) } : {}),
      }),
    );
  }
  return out.sort((a, b) => a.stepIndex - b.stepIndex || a.id.localeCompare(b.id));
}

function withFindingPages(
  findings: UiRunFinding[],
  steps: Step[],
  pageShots?: Map<string, string>,
): UiRunFinding[] {
  const byIndex = new Map(steps.map((s) => [s.index, s]));
  return findings.map((f) => {
    const step = byIndex.get(f.stepIndex);
    const pageId = f.pageId ?? step?.atPageId ?? step?.pageId;
    const screenshotUrl = f.screenshotUrl ?? (pageId ? pageShots?.get(pageId) : undefined);
    return {
      ...f,
      ...(pageId ? { pageId } : {}),
      ...(screenshotUrl ? { screenshotUrl } : {}),
    };
  });
}

function attachShots(runDir: string, runId: string, steps: Step[], findings: UiRunFinding[]): Step[] {
  const byIndex = new Map<number, UiRunFinding[]>();
  for (const f of findings) {
    const list = byIndex.get(f.stepIndex) ?? [];
    list.push(f);
    byIndex.set(f.stepIndex, list);
  }
  const rels = shotRelsByIndex(runDir);
  return steps.map((step) => {
    const hit = byIndex.get(step.index)?.[0];
    const rel = rels.get(step.index);
    const shotFromStep = rel ? runFileUrl(runId, rel) : undefined;
    const screenshotUrl = hit?.screenshotUrl ?? shotFromStep;
    return {
      ...step,
      ...(screenshotUrl ? { screenshotUrl } : {}),
      ...(hit
        ? {
            findingId: hit.id,
            findingMessage: hit.message,
            findingSeverity: hit.severity,
            finding: step.finding ?? hit.kind,
          }
        : {}),
    };
  });
}

export function resolveRunDir(configPath: string, runId: string): string | undefined {
  if (!runId || runId.includes("/") || runId.includes("\\") || runId.includes("..")) return undefined;
  const listed = listRuns(configPath).find((r) => r.id === runId);
  if (listed) return listed.dir;
  const dir = join(runsDir(configPath), runId);
  return existsSync(dir) ? dir : undefined;
}

export function buildRunDetail(configPath: string, runId: string): UiRunDetail | undefined {
  const dir = resolveRunDir(configPath, runId);
  if (!dir) return undefined;
  const ident = identityFromRunId(runId);
  const presence = loadPresence(presencePath(dir));
  const navPath = join(dir, "nav.jsonl");
  const parsed = existsSync(navPath) ? stepsFromNavLog(readFileSync(navPath, "utf8")) : { steps: [] };
  const findings = withFindingPages(
    collectFindings(dir, runId),
    parsed.steps,
    latestPageScreenshotUrls([{ id: runId, dir }]),
  );
  const steps = attachShots(dir, runId, parsed.steps, findings);
  const startedAt = presence?.startedAt ?? parsed.boot?.ts ?? steps[0]?.ts;
  return UiRunDetail.parse({
    schemaVersion: 1,
    id: runId,
    name: presence?.name ?? ident.name,
    hue: presence?.hue ?? ident.hue,
    live: presence ? isPresenceLive(presence) : false,
    findingCount: countFindings(dir),
    steps,
    findings,
    ...(presence?.pageId ? { pageId: presence.pageId } : {}),
    ...(presence?.brain ? { brain: presence.brain } : {}),
    ...(presence?.outline ? { outline: presence.outline } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(parsed.boot ? { boot: parsed.boot } : {}),
  });
}

export function isSafeRunId(runId: string): boolean {
  return Boolean(runId) && runId === basename(runId) && !runId.includes("..");
}
