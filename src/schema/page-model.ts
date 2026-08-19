import { z } from "zod";
import { Locator, LocatorBy } from "./locator.js";

export const FieldType = z.enum([
  "text",
  "textarea",
  "email",
  "number",
  "password",
  "checkbox",
  "radio",
  "select",
  "date",
  "datetime",
]);
export type FieldType = z.infer<typeof FieldType>;

export const WidgetStatus = z.enum(["ok", "unresolved", "drift"]);
export type WidgetStatus = z.infer<typeof WidgetStatus>;

export const Id = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, {
  message: "id must match /^[A-Za-z][A-Za-z0-9_]*$/",
});

const locatorNameRefine = (
  widget: { by: LocatorBy; name?: string },
  ctx: z.RefinementCtx,
) => {
  if (widget.by !== "role" && widget.name !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'name is only valid when by is "role"',
      path: ["name"],
    });
  }
};

export const Field = z
  .object({
    id: Id,
    required: z.boolean().default(false),
    type: FieldType,
    by: LocatorBy,
    value: z.string().min(1),
    name: z.string().min(1).optional(),
    status: WidgetStatus.default("ok"),
    previousLabel: z.string().min(1).optional(),
  })
  .strict()
  .superRefine(locatorNameRefine);
export type Field = z.infer<typeof Field>;

export const Action = z
  .object({
    id: Id,
    by: LocatorBy,
    value: z.string().min(1),
    name: z.string().min(1).optional(),
    opens: z.string().min(1).optional(),
    status: WidgetStatus.default("ok"),
    previousLabel: z.string().min(1).optional(),
  })
  .strict()
  .superRefine(locatorNameRefine);
export type Action = z.infer<typeof Action>;

export const SurfaceKind = z.enum(["page", "dialog"]);
export type SurfaceKind = z.infer<typeof SurfaceKind>;

export const Surface = z
  .object({
    id: Id,
    kind: SurfaceKind,
    locator: Locator.optional(),
    fields: z.array(Field).default([]),
    actions: z.array(Action).default([]),
  })
  .strict()
  .superRefine((s, ctx) => {
    const ids = [...s.fields, ...s.actions].map((w) => w.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate widget id on surface ${s.id}`,
      });
    }
  });
export type Surface = z.infer<typeof Surface>;

export const Page = z
  .object({
    id: Id,
    path: z.string().min(1),
    /** Set when this page lives on another origin than the leash `url`. */
    origin: z.string().url().optional(),
    /** Intro / start page. Walkers do not hop here after intro. */
    entry: z.boolean().optional(),
    params: z.array(z.string().min(1)).default([]),
    ready: Locator,
    surfaces: z.array(Surface).min(1),
    /** One-line what this page is. Inspect writes a mechanical blurb; vision/explore may polish. */
    description: z.string().min(1).optional(),
    /** Who last wrote `description`. */
    describedBy: z.enum(["inspect", "explore", "vision"]).optional(),
    /** Widget fingerprint when `description` was written. */
    describeKey: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((page, ctx) => {
    const pageSurfaces = page.surfaces.filter((s) => s.kind === "page");
    if (pageSurfaces.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'each page must have exactly one surface with kind "page"',
        path: ["surfaces"],
      });
    }
    const sids = page.surfaces.map((s) => s.id);
    if (new Set(sids).size !== sids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "duplicate surface id",
        path: ["surfaces"],
      });
    }
    const pathParams = [...page.path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map(
      (m) => m[1],
    );
    for (const p of pathParams) {
      if (p && !page.params.includes(p)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `path param :${p} must be listed in params`,
          path: ["params"],
        });
      }
    }
  });
export type Page = z.infer<typeof Page>;

export const PageModel = z
  .object({
    schemaVersion: z.literal(1),
    app: z.string().min(1),
    generation: z.number().int().nonnegative().default(0),
    pages: z.array(Page).min(1),
  })
  .strict()
  .superRefine((model, ctx) => {
    const ids = model.pages.map((p) => p.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "duplicate page id",
        path: ["pages"],
      });
    }
  });
export type PageModel = z.infer<typeof PageModel>;

/** Inspect input only. Missing config map starts here. */
export const PageModelDraft = z
  .object({
    schemaVersion: z.literal(1),
    app: z.string().min(1),
    generation: z.number().int().nonnegative().default(0),
    pages: z.array(Page).default([]),
  })
  .strict();
export type PageModelDraft = z.infer<typeof PageModelDraft>;

export function emptyDraft(app = "app"): PageModelDraft {
  return { schemaVersion: 1, app, generation: 0, pages: [] };
}

export type Widget = Field | Action;
