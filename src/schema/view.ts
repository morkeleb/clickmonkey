import { z } from "zod";
import { FieldType } from "./page-model.js";
import { TestabilityIssue } from "./testability.js";

export const ShownField = z
  .object({
    id: z.string().min(1),
    value: z.string(),
    required: z.boolean().optional(),
    type: FieldType.optional(),
    label: z.string().min(1).optional(),
  })
  .strict();
export type ShownField = z.infer<typeof ShownField>;

export const ShownAction = z
  .object({
    id: z.string().min(1),
    opens: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
  })
  .strict();
export type ShownAction = z.infer<typeof ShownAction>;

export const ViewLast = z
  .object({
    step: z.string().min(1),
    ok: z.boolean(),
    finding: z.string().min(1).optional(),
  })
  .strict();
export type ViewLast = z.infer<typeof ViewLast>;

export const View = z
  .object({
    page: z.string().min(1),
    surface: z.string().min(1),
    stack: z.array(z.string().min(1)).min(1),
    shown: z.array(ShownField),
    actions: z.array(ShownAction),
    content: z.string().min(1).optional(),
    testability: z
      .object({
        insufficient: z.boolean(),
        issues: z.array(TestabilityIssue),
      })
      .strict()
      .optional(),
    last: ViewLast.optional(),
  })
  .strict();
export type View = z.infer<typeof View>;
