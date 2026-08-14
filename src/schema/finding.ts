import { z } from "zod";

export const FindingKind = z.enum([
  "expectFailed",
  "httpError",
  "notFound",
  "pageError",
  "fenceViolation",
  "unresolvedId",
  "unknownId",
  "driftId",
  "writePolicyBlocked",
  "locatorAmbiguous",
]);
export type FindingKind = z.infer<typeof FindingKind>;

export const Finding = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    kind: FindingKind,
    message: z.string().min(1),
    tapePath: z.string().min(1),
    screenshotPath: z.string().min(1).optional(),
    stepIndex: z.number().int().nonnegative(),
    httpStatus: z.number().int().optional(),
    url: z.string().min(1).optional(),
    widgetRef: z.string().min(1).optional(),
  })
  .strict();
export type Finding = z.infer<typeof Finding>;

export function findingId(stepIndex: number, kind: FindingKind, n?: number): string {
  return n === undefined
    ? `fnd_${stepIndex}_${kind}`
    : `fnd_${stepIndex}_${kind}_${n}`;
}
