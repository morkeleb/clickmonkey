import { z } from "zod";

export const LocatorBy = z.enum(["testId", "name", "role", "label"]);
export type LocatorBy = z.infer<typeof LocatorBy>;

/** Shared by Locator, Field, and Action so widget locators cannot drift. */
export const locatorShape = {
  by: LocatorBy,
  value: z.string().min(1),
  name: z.string().min(1).optional(),
  /** Playwright `.nth` index; 0 is omitted on the first match. */
  nth: z.number().int().positive().optional(),
};

export const Locator = z
  .object(locatorShape)
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
export function locatorOf(w: { by: LocatorBy; value: string; name?: string; nth?: number }): Locator {
  return {
    by: w.by,
    value: w.value,
    ...(w.name !== undefined ? { name: w.name } : {}),
    ...(w.nth !== undefined && w.nth > 0 ? { nth: w.nth } : {}),
  };
}

export function locatorIdentity(loc: { by: string; value: string; name?: string; nth?: number }): string {
  const nth = loc.nth && loc.nth > 0 ? String(loc.nth) : "";
  return `${loc.by}\0${loc.value}\0${loc.name ?? ""}\0${nth}`;
}
