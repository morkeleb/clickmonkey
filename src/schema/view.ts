import { z } from "zod";
import { WalkerModeName } from "./fog.js";
import { FieldType } from "./page-model.js";
import { TestabilityIssue } from "./testability.js";

export const ShownFieldOption = z
  .object({
    value: z.string(),
    label: z.string(),
  })
  .strict();
export type ShownFieldOption = z.infer<typeof ShownFieldOption>;

/** Live HTML constraints. Not stored on the map. */
export const ShownFieldConstraints = z
  .object({
    min: z.string().min(1).optional(),
    max: z.string().min(1).optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().positive().optional(),
    step: z.string().min(1).optional(),
    pattern: z.string().min(1).optional(),
    autocomplete: z.string().min(1).optional(),
    inputMode: z.string().min(1).optional(),
    htmlType: z.string().min(1).optional(),
    placeholder: z.string().min(1).optional(),
  })
  .strict();
export type ShownFieldConstraints = z.infer<typeof ShownFieldConstraints>;

export const ShownField = z
  .object({
    id: z.string().min(1),
    value: z.string(),
    required: z.boolean().optional(),
    type: FieldType.optional(),
    label: z.string().min(1).optional(),
    /** Live `<option>` list on a native select. Not stored on the map. */
    options: z.array(ShownFieldOption).optional(),
    constraints: ShownFieldConstraints.optional(),
  })
  .strict();
export type ShownField = z.infer<typeof ShownField>;

export const ShownAction = z
  .object({
    id: z.string().min(1),
    opens: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    /** Inside a navigation landmark. Map prefers these; unleash prefers the rest. */
    nav: z.boolean().optional(),
    /** ARIA role when the map locator is `by: "role"` (`button`, `link`, `menuitem`, …). */
    role: z.string().min(1).optional(),
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

export const LookFont = z
  .object({
    family: z.string().min(1),
    size: z.string().min(1),
    weight: z.string().min(1),
    count: z.number().int().positive(),
  })
  .strict();
export type LookFont = z.infer<typeof LookFont>;

export const LookCovered = z
  .object({
    id: z.string().min(1),
    by: z.string().min(1),
  })
  .strict();
export type LookCovered = z.infer<typeof LookCovered>;

/** Not persisted on the map. */
export const Look = z
  .object({
    fonts: z.array(LookFont).default([]),
    covered: z.array(LookCovered).default([]),
  })
  .strict();
export type Look = z.infer<typeof Look>;

export const View = z
  .object({
    page: z.string().min(1),
    pages: z.array(z.string().min(1)).optional(),
    /** id → map blurb. Hop list stays in `pages`. */
    pageNotes: z.record(z.string().min(1), z.string().min(1)).optional(),
    surface: z.string().min(1),
    stack: z.array(z.string().min(1)).min(1),
    shown: z.array(ShownField),
    actions: z.array(ShownAction),
    look: Look.optional(),
    content: z.string().min(1).optional(),
    testability: z
      .object({
        insufficient: z.boolean(),
        issues: z.array(TestabilityIssue),
      })
      .strict()
      .optional(),
    last: ViewLast.optional(),
    mode: WalkerModeName.optional(),
  })
  .strict();
export type View = z.infer<typeof View>;
