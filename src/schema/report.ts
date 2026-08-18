import { z } from "zod";

export const ReportMeta = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    generatedAt: z.string().min(1),
    url: z.string().min(1).optional(),
    runIds: z.array(z.string().min(1)),
    findingCount: z.number().int().nonnegative(),
    title: z.string().min(1),
  })
  .strict();
export type ReportMeta = z.infer<typeof ReportMeta>;
