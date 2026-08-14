import { z } from "zod";
import { PageModel, PageModelDraft } from "./page-model.js";

export const Fence = z
  .object({
    path: z.string().min(1).optional(),
    blacklist: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type Fence = z.infer<typeof Fence>;

export const WritePolicy = z.enum(["validationOnly"]);
export type WritePolicy = z.infer<typeof WritePolicy>;

export const Config = z
  .object({
    url: z.string().url(),
    fence: Fence.optional(),
    intro: z.array(z.string()).default([]),
    writePolicy: WritePolicy.default("validationOnly"),
    map: PageModelDraft,
  })
  .strict();
export type Config = z.infer<typeof Config>;

export type UserConfig = z.input<typeof Config>;

export class LegacyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LegacyConfigError";
  }
}

/** Reject 0.0.7 files before Zod so the error is a migration message. */
export function assertNotLegacyConfig(raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const o = raw as Record<string, unknown>;
  if (typeof o.intro === "function" || "proxy_port" in o) {
    throw new LegacyConfigError(
      "This looks like a ClickMonkey 0.0.7 config (intro/proxy_port). " +
        "v2 does not run those files. Run `clickmonkey init` and use intro DSL lines with $ENV secrets.",
    );
  }
}

export function emptyConfig(url: string, app = "app"): Config {
  return Config.parse({
    url,
    fence: { blacklist: [] },
    intro: [],
    writePolicy: "validationOnly",
    map: { schemaVersion: 1, app, generation: 0, pages: [] },
  });
}

export function requirePageModel(map: PageModelDraft): PageModel {
  return PageModel.parse(map);
}
