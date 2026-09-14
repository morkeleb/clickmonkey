import { z } from "zod";

/** Replay of the same tape did not reproduce. Not a later unleash/nasty land. */
export const FixedItem = z
  .object({
    fixedAt: z.string().min(1),
    idempotencyKey: z.string().min(1),
    id: z.string().min(1).optional(),
    lastRunId: z.string().min(1).optional(),
    reportId: z.string().min(1).optional(),
    replayId: z.string().min(1).optional(),
    kind: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
  })
  .strict();
export type FixedItem = z.infer<typeof FixedItem>;

export const FixedLedger = z
  .object({
    schemaVersion: z.literal(1),
    items: z.array(FixedItem),
  })
  .strict();
export type FixedLedger = z.infer<typeof FixedLedger>;
