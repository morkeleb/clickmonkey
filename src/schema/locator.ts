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

/** Shared locator object from a widget or candidate. One place — do not reimplement. */
export function locatorOf(w: { by: LocatorBy; value: string; name?: string }): Locator {
  return w.name === undefined ? { by: w.by, value: w.value } : { by: w.by, value: w.value, name: w.name };
}

export function locatorIdentity(loc: { by: string; value: string; name?: string }): string {
  return `${loc.by}\0${loc.value}\0${loc.name ?? ""}`;
}
