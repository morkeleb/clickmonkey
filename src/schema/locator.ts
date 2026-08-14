import { z } from "zod";

export const LocatorBy = z.enum(["testId", "name", "role", "label"]);
export type LocatorBy = z.infer<typeof LocatorBy>;

export const Locator = z
  .object({
    by: LocatorBy,
    value: z.string().min(1),
    name: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((loc, ctx) => {
    if (loc.by !== "role" && loc.name !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'locator.name is only valid when by is "role"',
        path: ["name"],
      });
    }
  });
export type Locator = z.infer<typeof Locator>;
