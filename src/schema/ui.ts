import { z } from "zod";
import { PageModel, PageModelDraft, parsePageModelDraft } from "./page-model.js";
import { QualityReport } from "./quality.js";
import { TestabilityReport } from "./testability.js";

export const UiGraphKind = z.enum(["page", "dialog"]);
export type UiGraphKind = z.infer<typeof UiGraphKind>;

export const UiGraphNode = z
  .object({
    id: z.string().min(1),
    kind: UiGraphKind,
    pageId: z.string().min(1),
    label: z.string().min(1),
    path: z.string().min(1),
    origin: z.string().min(1).optional(),
    entry: z.boolean().optional(),
    blurb: z.string().min(1).optional(),
    describedBy: z.enum(["inspect", "explore", "vision"]).optional(),
    red: z.number().int().nonnegative(),
    yellow: z.number().int().nonnegative(),
    /** Latest still taken while on this page (`/files/runs/.../shots/pages/{pageId}.png`). */
    screenshotUrl: z.string().min(1).optional(),
  })
  .strict();
export type UiGraphNode = z.infer<typeof UiGraphNode>;

export const UiGraphEdge = z
  .object({
    id: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    label: z.string().min(1).optional(),
  })
  .strict();
export type UiGraphEdge = z.infer<typeof UiGraphEdge>;

export const UiGraph = z
  .object({
    nodes: z.array(UiGraphNode),
    edges: z.array(UiGraphEdge),
  })
  .strict();
export type UiGraph = z.infer<typeof UiGraph>;

export const UiRunHop = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    via: z.string().min(1).optional(),
    status: z.number().int().optional(),
  })
  .strict();
export type UiRunHop = z.infer<typeof UiRunHop>;

export const UiRunFinding = z
  .object({
    id: z.string().min(1),
    kind: z.string().min(1),
    severity: z.string().min(1),
    message: z.string().min(1),
    stepIndex: z.number().int().nonnegative(),
    url: z.string().min(1).optional(),
    pageId: z.string().min(1).optional(),
    widgetRef: z.string().min(1).optional(),
    screenshotUrl: z.string().min(1).optional(),
  })
  .strict();
export type UiRunFinding = z.infer<typeof UiRunFinding>;

/** Map-node badge + sheet: one finding folder, with the run that owns it. */
export const UiMapFinding = z
  .object({
    id: z.string().min(1),
    runId: z.string().min(1),
    kind: z.string().min(1),
    severity: z.string().min(1),
    message: z.string().min(1),
    url: z.string().min(1).optional(),
    pageId: z.string().min(1).optional(),
    /** `ledgerPath` of the finding URL so the sheet matches graph badges. */
    path: z.string().min(1).optional(),
    screenshotUrl: z.string().min(1).optional(),
  })
  .strict();
export type UiMapFinding = z.infer<typeof UiMapFinding>;

export const UiRunStep = z
  .object({
    index: z.number().int().nonnegative(),
    ts: z.string().min(1),
    line: z.string().min(1),
    pageId: z.string().min(1).optional(),
    /** Page after the step — where the screenshot was taken. */
    atPageId: z.string().min(1).optional(),
    phase: z.string().min(1).optional(),
    ok: z.boolean().optional(),
    ms: z.number().nonnegative().optional(),
    finding: z.string().min(1).optional(),
    hops: z.array(UiRunHop).optional(),
    screenshotUrl: z.string().min(1).optional(),
    findingId: z.string().min(1).optional(),
    findingMessage: z.string().min(1).optional(),
    findingSeverity: z.string().min(1).optional(),
    note: z.string().min(1).optional(),
    good: z.string().min(1).optional(),
    sight: z.string().min(1).optional(),
  })
  .strict();
export type UiRunStep = z.infer<typeof UiRunStep>;

export const UiRunBoot = z
  .object({
    ts: z.string().min(1),
    hops: z.array(UiRunHop),
  })
  .strict();
export type UiRunBoot = z.infer<typeof UiRunBoot>;

export const UiExplorePlanItem = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    page: z.string().min(1).optional(),
    status: z.enum(["pending", "now", "done", "skipped"]).default("pending"),
    stepCount: z.number().int().nonnegative().default(0),
    findingIds: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type UiExplorePlanItem = z.infer<typeof UiExplorePlanItem>;

export function explorePlanItemMark(status: UiExplorePlanItem["status"]): string {
  return status === "done" ? "x" : status === "now" ? ">" : status === "skipped" ? "-" : " ";
}

export function formatExplorePlanItemCoverage(item: UiExplorePlanItem): string {
  const steps = item.stepCount ?? 0;
  const ids = item.findingIds ?? [];
  const stepBit = `${steps} step${steps === 1 ? "" : "s"}`;
  const findings =
    ids.length > 0 ? `, ${ids.length} finding${ids.length === 1 ? "" : "s"}: ${ids.join(", ")}` : "";
  if (item.status === "pending") return "never started";
  if (item.status === "skipped") return `skipped, ${stepBit}${findings}`;
  if (item.status === "now") return `in progress, ${stepBit}${findings}`;
  return `${stepBit}${findings}`;
}

export function formatExplorePlanItemLine(item: UiExplorePlanItem): string {
  const page = item.page ? ` (${item.page})` : "";
  return `- [${explorePlanItemMark(item.status)}] ${item.title}${page} — ${formatExplorePlanItemCoverage(item)}`;
}

export const UiExplorePlan = z
  .object({
    goal: z.string().min(1),
    items: z.array(UiExplorePlanItem).min(1).max(8),
  })
  .strict();
export type UiExplorePlan = z.infer<typeof UiExplorePlan>;

export const UiExploreOutline = z
  .object({
    charter: z.string().min(1),
    now: z.string().min(1).optional(),
    notes: z.array(z.string().min(1)).max(12).default([]),
    goods: z.array(z.string().min(1)).max(12).default([]),
    plan: UiExplorePlan.optional(),
  })
  .strict();
export type UiExploreOutline = z.infer<typeof UiExploreOutline>;

export const UiRun = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    hue: z.number().int().min(0).max(359),
    live: z.boolean(),
    pageId: z.string().min(1).optional(),
    findingCount: z.number().int().nonnegative(),
    brain: z.string().min(1).optional(),
    outline: UiExploreOutline.optional(),
    boot: UiRunBoot.optional(),
    steps: z.array(UiRunStep).optional(),
  })
  .strict();
export type UiRun = z.infer<typeof UiRun>;

export const UiRunDetail = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    name: z.string().min(1),
    hue: z.number().int().min(0).max(359),
    live: z.boolean(),
    pageId: z.string().min(1).optional(),
    brain: z.string().min(1).optional(),
    outline: UiExploreOutline.optional(),
    findingCount: z.number().int().nonnegative(),
    startedAt: z.string().min(1).optional(),
    boot: UiRunBoot.optional(),
    steps: z.array(UiRunStep),
    findings: z.array(UiRunFinding),
  })
  .strict();
export type UiRunDetail = z.infer<typeof UiRunDetail>;

export const UiLeash = z
  .object({
    url: z.string().min(1),
    fence: z
      .object({
        path: z.string().min(1).optional(),
        blacklist: z.array(z.string()).default([]),
      })
      .optional(),
    intro: z.array(z.string()).default([]),
    skip: z.array(z.string()).default([]),
    writePolicy: z.string().min(1),
    screenshots: z.boolean().default(true),
    brainModel: z.string().min(1).optional(),
    visionModel: z.string().min(1).optional(),
  })
  .strict();
export type UiLeash = z.infer<typeof UiLeash>;

export const UiReport = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    generatedAt: z.string().min(1),
    runIds: z.array(z.string()),
    findingCount: z.number().int().nonnegative(),
  })
  .strict();
export type UiReport = z.infer<typeof UiReport>;

/** Shown on the live UI when the snapshot is stale or failed. Not a finding. */
export const UiNotice = z
  .object({
    level: z.enum(["warn", "error"]),
    title: z.string().min(1),
    message: z.string().min(1),
    hint: z.string().min(1).optional(),
    detail: z.string().min(1).optional(),
    action: z.enum(["restart"]).optional(),
  })
  .strict();
export type UiNotice = z.infer<typeof UiNotice>;

export const UiFault = z
  .object({
    error: z.literal(true),
    title: z.string().min(1),
    message: z.string().min(1),
    hint: z.string().min(1),
    detail: z.string().min(1).optional(),
    copy: z.string().min(1),
  })
  .strict();
export type UiFault = z.infer<typeof UiFault>;

export const UiSnapshot = z
  .object({
    schemaVersion: z.literal(1),
    leash: UiLeash,
    map: PageModelDraft,
    graph: UiGraph,
    testability: TestabilityReport,
    quality: QualityReport,
    runs: z.array(UiRun),
    findings: z.array(UiMapFinding).default([]),
    reports: z.array(UiReport).default([]),
    notice: UiNotice.optional(),
  })
  .strict();
export type UiSnapshot = z.infer<typeof UiSnapshot>;

export const UiEventType = z.enum(["hello", "map", "quality", "testability", "run", "nav"]);
export type UiEventType = z.infer<typeof UiEventType>;

export const UiEvent = z
  .object({
    type: UiEventType,
    snapshot: UiSnapshot.optional(),
    /** Cheap live patch: walker pageId / presence without rebuilding the map. */
    runs: z.array(UiRun).optional(),
  })
  .strict();
export type UiEvent = z.infer<typeof UiEvent>;

export const Presence = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    name: z.string().min(1),
    hue: z.number().int().min(0).max(359),
    pid: z.number().int().positive(),
    brain: z.string().min(1).optional(),
    outline: UiExploreOutline.optional(),
    pageId: z.string().min(1),
    startedAt: z.string().min(1),
    updatedAt: z.string().min(1),
    stoppedAt: z.string().min(1).nullable().default(null),
  })
  .strict();
export type Presence = z.infer<typeof Presence>;

/** PageModel is the persisted map; drafts are accepted while generation is in flight. */
export function parseMapForUi(raw: unknown): z.infer<typeof PageModelDraft> {
  const full = PageModel.safeParse(raw);
  if (full.success) return full.data;
  return parsePageModelDraft(raw, { dropUnknown: true });
}
