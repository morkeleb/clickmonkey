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
  "uiIssue",
]);
export type FindingKind = z.infer<typeof FindingKind>;

export const FindingSeverity = z.enum(["critical", "major", "minor", "suggestion"]);
export type FindingSeverity = z.infer<typeof FindingSeverity>;

export function severityForKind(kind: FindingKind): FindingSeverity {
  switch (kind) {
    case "pageError":
    case "httpError":
    case "notFound":
      return "critical";
    case "expectFailed":
    case "fenceViolation":
    case "writePolicyBlocked":
      return "major";
    case "unresolvedId":
    case "unknownId":
    case "driftId":
    case "locatorAmbiguous":
      return "minor";
    case "uiIssue":
      return "suggestion";
  }
}

export const Finding = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    kind: FindingKind,
    severity: FindingSeverity.optional(),
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
