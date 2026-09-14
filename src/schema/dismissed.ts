import { z } from "zod";

export const DismissedItem = z
  .object({
    dismissedAt: z.string().min(1),
    id: z.string().min(1),
    runId: z.string().min(1).optional(),
    /** Canonical fingerprint of the bug. Kept so older ledgers still match. */
    fingerprint: z.string().min(1).optional(),
    /** `ik_` of the bug. One prune dismisses later runs of the same finding. */
    idempotencyKey: z.string().min(1).optional(),
    kind: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    reportId: z.string().min(1).optional(),
  })
  .strict();
export type DismissedItem = z.infer<typeof DismissedItem>;

export const DismissedLedger = z
  .object({
    schemaVersion: z.literal(1),
    items: z.array(DismissedItem),
  })
  .strict();
export type DismissedLedger = z.infer<typeof DismissedLedger>;
