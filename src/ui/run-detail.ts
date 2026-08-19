import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
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

export function runFileUrl(runId: string, rel: string): string {
  return `/files/runs/${runId}/${rel.split("\\").join("/")}`;
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
  let pending: { line?: string; note?: string; good?: string } | undefined;
  let current: {
    ts: string;
    line: string;
    pageId?: string;
    phase?: string;
    hops: Hop[];
    note?: string;
    good?: string;
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
      };
      pending = undefined;
      continue;
    }
    if (type === "stepDone") {
      if (!current) continue;
      const hops = current.hops;
      steps.push(
        UiRunStep.parse({
          index: steps.length,
          ts: current.ts,
          line: current.line,
          ...(current.pageId ? { pageId: current.pageId } : {}),
          ...(current.phase ? { phase: current.phase } : {}),
          ...(typeof ev.ok === "boolean" ? { ok: ev.ok } : {}),
          ...(asNumber(ev.ms) !== undefined ? { ms: asNumber(ev.ms) } : {}),
          ...(asString(ev.finding) ? { finding: asString(ev.finding) } : {}),
          ...(hops.length > 0 ? { hops } : {}),
          ...(current.note ? { note: current.note } : {}),
          ...(current.good ? { good: current.good } : {}),
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
        ...(finding.widgetRef ? { widgetRef: finding.widgetRef } : {}),
        ...(existsSync(shot) ? { screenshotUrl: runFileUrl(runId, `findings/${name}/screenshot.png`) } : {}),
      }),
    );
  }
  return out.sort((a, b) => a.stepIndex - b.stepIndex || a.id.localeCompare(b.id));
}

function attachShots(runDir: string, runId: string, steps: Step[], findings: UiRunFinding[]): Step[] {
  const byIndex = new Map<number, UiRunFinding[]>();
  for (const f of findings) {
    const list = byIndex.get(f.stepIndex) ?? [];
    list.push(f);
    byIndex.set(f.stepIndex, list);
  }
  return steps.map((step) => {
    const hit = byIndex.get(step.index)?.[0];
    const padded = `shots/step-${String(step.index).padStart(3, "0")}.png`;
    const shotFromStep = existsSync(join(runDir, padded)) ? runFileUrl(runId, padded) : undefined;
    const screenshotUrl = hit?.screenshotUrl ?? shotFromStep;
    return UiRunStep.parse({
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
    });
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
  const findings = collectFindings(dir, runId);
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
