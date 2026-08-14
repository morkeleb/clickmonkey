import { z } from "zod";
import { Locator } from "./locator.js";

export const OpenStep = z
  .object({ kind: z.literal("open"), page: z.string().min(1) })
  .strict();
export type OpenStep = z.infer<typeof OpenStep>;

export const ClickStep = z
  .object({
    kind: z.literal("click"),
    surface: z.string().min(1),
    id: z.string().min(1),
  })
  .strict();
export type ClickStep = z.infer<typeof ClickStep>;

export const FillStep = z
  .object({
    kind: z.literal("fill"),
    surface: z.string().min(1),
    id: z.string().min(1),
    value: z.string(),
  })
  .strict();
export type FillStep = z.infer<typeof FillStep>;

export const ExpectInvalidStep = z
  .object({
    kind: z.literal("expectInvalid"),
    surface: z.string().min(1),
    id: z.string().min(1),
  })
  .strict();
export type ExpectInvalidStep = z.infer<typeof ExpectInvalidStep>;

export const ExpectVisibleStep = z
  .object({
    kind: z.literal("expectVisible"),
    surface: z.string().min(1),
  })
  .strict();
export type ExpectVisibleStep = z.infer<typeof ExpectVisibleStep>;

export const ExpectPathStep = z
  .object({
    kind: z.literal("expectPath"),
    path: z.string().min(1),
  })
  .strict();
export type ExpectPathStep = z.infer<typeof ExpectPathStep>;

export const ScreenshotStep = z
  .object({
    kind: z.literal("screenshot"),
    label: z.string().min(1).optional(),
    ui: z.boolean().optional(),
  })
  .strict();
export type ScreenshotStep = z.infer<typeof ScreenshotStep>;

export const Step = z.discriminatedUnion("kind", [
  OpenStep,
  ClickStep,
  FillStep,
  ExpectInvalidStep,
  ExpectVisibleStep,
  ExpectPathStep,
  ScreenshotStep,
]);
export type Step = z.infer<typeof Step>;

export const UsedLocator = Locator;
export type UsedLocator = z.infer<typeof UsedLocator>;

export const LogResult = z.enum(["passed", "failed", "error"]);
export type LogResult = z.infer<typeof LogResult>;

export const Log = z
  .object({
    schemaVersion: z.literal(1),
    bug: z.string().min(1).optional(),
    found: z.string().min(1).optional(),
    comments: z.array(z.string()).default([]),
    steps: z.array(Step),
    usedLocators: z.record(z.string().min(1), UsedLocator).default({}),
    result: LogResult.optional(),
  })
  .strict();
export type Log = z.infer<typeof Log>;
