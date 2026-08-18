import { z } from "zod";
import { PageModel, PageModelDraft } from "./page-model.js";
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
    red: z.number().int().nonnegative(),
    yellow: z.number().int().nonnegative(),
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
    widgetRef: z.string().min(1).optional(),
    screenshotUrl: z.string().min(1).optional(),
  })
  .strict();
export type UiRunFinding = z.infer<typeof UiRunFinding>;

export const UiRunStep = z
  .object({
    index: z.number().int().nonnegative(),
    ts: z.string().min(1),
    line: z.string().min(1),
    pageId: z.string().min(1).optional(),
    phase: z.string().min(1).optional(),
    ok: z.boolean().optional(),
    ms: z.number().nonnegative().optional(),
    finding: z.string().min(1).optional(),
    hops: z.array(UiRunHop).optional(),
    screenshotUrl: z.string().min(1).optional(),
    findingId: z.string().min(1).optional(),
    findingMessage: z.string().min(1).optional(),
    findingSeverity: z.string().min(1).optional(),
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

export const UiRun = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    hue: z.number().int().min(0).max(359),
    live: z.boolean(),
    pageId: z.string().min(1).optional(),
    findingCount: z.number().int().nonnegative(),
    brain: z.string().min(1).optional(),
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
    brainModel: z.string().min(1).optional(),
  })
  .strict();
export type UiLeash = z.infer<typeof UiLeash>;

export const UiSnapshot = z
  .object({
    schemaVersion: z.literal(1),
    leash: UiLeash,
    map: PageModelDraft,
    graph: UiGraph,
    testability: TestabilityReport,
    quality: QualityReport,
    runs: z.array(UiRun),
    reportMarkdown: z.string().optional(),
  })
  .strict();
export type UiSnapshot = z.infer<typeof UiSnapshot>;

export const UiEventType = z.enum(["hello", "map", "quality", "testability", "run", "nav"]);
export type UiEventType = z.infer<typeof UiEventType>;

export const UiEvent = z
  .object({
    type: UiEventType,
    snapshot: UiSnapshot.optional(),
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
  return PageModelDraft.parse(raw);
}
