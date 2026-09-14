import { isConfirmedFixed, type FixedLedger } from "../persist/fixed.js";
import { findingIdentityOf } from "../persist/finding.js";
import type { FindingCase } from "../persist/runs.js";

export type FindingLifecycle = "new" | "still" | "fixed";

export type ClassifiedCluster = {
  key: string;
  status: FindingLifecycle;
  firstRunId: string;
  lastRunId: string;
  retestRunId?: string;
  cases: FindingCase[];
};

function compareRunId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function identityKey(c: FindingCase): string {
  return findingIdentityOf(c.finding, { url: c.url, pageId: c.pageId }).idempotencyKey;
}

function groupByIk(cases: FindingCase[]): Map<string, FindingCase[]> {
  const by = new Map<string, FindingCase[]>();
  for (const c of cases) {
    const key = identityKey(c);
    const list = by.get(key);
    if (list) list.push(c);
    else by.set(key, [c]);
  }
  return by;
}

/**
 * `fixed` = replay of the same tape did not reproduce, and no later walk refiled this `ik_`.
 * A later unleash/nasty land is not a retest: those walks type different values.
 */
export function classifyFindingClusters(opts: {
  selected: FindingCase[];
  all: FindingCase[];
  selectedRunIds: readonly string[];
  confirmed?: FixedLedger;
}): { open: ClassifiedCluster[]; fixed: ClassifiedCluster[] } {
  const allByIk = groupByIk(opts.all);
  const selectedByIk = groupByIk(opts.selected);
  const selectedSet = new Set(opts.selectedRunIds);
  const newestSelected = [...opts.selectedRunIds].sort(compareRunId).at(-1);
  const confirmed = opts.confirmed ?? { schemaVersion: 1 as const, items: [] };
  const open: ClassifiedCluster[] = [];
  const fixed: ClassifiedCluster[] = [];

  const push = (key: string, filings: FindingCase[], selectedFilings: FindingCase[]) => {
    const filedRuns = [...new Set(filings.map((c) => c.runId))].sort(compareRunId);
    if (filedRuns.length === 0) return;
    const firstRunId = filedRuns[0]!;
    const lastRunId = filedRuns[filedRuns.length - 1]!;
    const replay = confirmed.items.find((i) => i.idempotencyKey === key);
    const status: FindingLifecycle = isConfirmedFixed(confirmed, {
      idempotencyKey: key,
      lastFiledRunId: lastRunId,
    })
      ? "fixed"
      : newestSelected && firstRunId === lastRunId && lastRunId === newestSelected
        ? "new"
        : "still";
    const row: ClassifiedCluster = {
      key,
      status,
      firstRunId,
      lastRunId,
      ...(replay?.replayId ? { retestRunId: replay.replayId } : {}),
      cases: selectedFilings.length > 0 ? selectedFilings : filings,
    };
    if (status === "fixed") {
      fixed.push(row);
      return;
    }
    if (selectedFilings.length > 0) open.push(row);
  };

  for (const [key, selectedFilings] of selectedByIk) {
    push(key, allByIk.get(key) ?? selectedFilings, selectedFilings);
  }
  for (const [key, filings] of allByIk) {
    if (selectedByIk.has(key)) continue;
    push(key, filings, filings.filter((c) => selectedSet.has(c.runId)));
  }
  return { open, fixed };
}

export function lifecycleByKey(
  classified: { open: ClassifiedCluster[]; fixed: ClassifiedCluster[] },
): Map<string, ClassifiedCluster> {
  const out = new Map<string, ClassifiedCluster>();
  for (const row of classified.open) out.set(row.key, row);
  for (const row of classified.fixed) out.set(row.key, row);
  return out;
}
