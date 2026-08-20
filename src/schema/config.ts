import { z } from "zod";
import { PageModel, PageModelDraft } from "./page-model.js";

export const Fence = z
  .object({
    path: z.string().min(1).optional(),
    blacklist: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type Fence = z.infer<typeof Fence>;

export const WritePolicy = z.enum(["validationOnly", "allow"]);
export type WritePolicy = z.infer<typeof WritePolicy>;

/** Pathname prefixes that skip title/description/OG checks. `"/"` matches every page. */
export const SeoConfig = z
  .object({
    private: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type SeoConfig = z.infer<typeof SeoConfig>;

export const BrainConfig = z
  .object({
    baseUrl: z.string().url(),
    model: z.string().min(1),
    apiKeyEnv: z.string().min(1).optional(),
  })
  .strict();
export type BrainConfig = z.infer<typeof BrainConfig>;

export const VisionConfig = z
  .object({
    baseUrl: z.string().url().optional(),
    /** Required on the vision block; never inherited from brain. */
    model: z.string().min(1),
    /** false = no key, even on the same host as brain. */
    apiKeyEnv: z.union([z.string().min(1), z.literal(false)]).optional(),
    issues: z.boolean().default(true),
    assist: z.boolean().default(true),
  })
  .strict()
  .superRefine((vision, ctx) => {
    if (vision.issues === false && vision.assist === false) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "vision.issues and vision.assist cannot both be false",
      });
    }
  });
export type VisionConfig = z.infer<typeof VisionConfig>;

export type ResolvedVision = {
  baseUrl: string;
  model: string;
  apiKeyEnv?: string;
  issues: boolean;
  assist: boolean;
};

export class VisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisionError";
  }
}

export function resolveVision(
  vision: VisionConfig | undefined,
  brain: BrainConfig | undefined,
): ResolvedVision | undefined {
  if (!vision) return undefined;
  const baseUrl = vision.baseUrl ?? brain?.baseUrl;
  if (!baseUrl) {
    throw new VisionError("vision.baseUrl is required (set vision.baseUrl or brain.baseUrl)");
  }
  let apiKeyEnv: string | undefined;
  if (vision.apiKeyEnv === false) {
    apiKeyEnv = undefined;
  } else if (typeof vision.apiKeyEnv === "string") {
    apiKeyEnv = vision.apiKeyEnv;
  } else if (!vision.baseUrl) {
    apiKeyEnv = brain?.apiKeyEnv;
  }
  return {
    baseUrl,
    model: vision.model,
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
    issues: vision.issues,
    assist: vision.assist,
  };
}

export function requireVisionShots(config: Pick<Config, "screenshots" | "vision" | "brain">): void {
  const vision = resolveVision(config.vision, config.brain);
  if (vision && config.screenshots === false) {
    throw new VisionError('vision needs per-step screenshots; set "screenshots": true or omit vision');
  }
}

/** On-disk leash. load still accepts an inline map so one-file leashes work. */
export const LeashFile = z
  .object({
    url: z.string().url(),
    fence: Fence.optional(),
    intro: z.array(z.string()).default([]),
    /** Substrings of widget id or label the walker will not click (logout, close panel, …). */
    skip: z.array(z.string().min(1)).default([]),
    writePolicy: WritePolicy.default("validationOnly"),
    /** Per-step screenshots. Omit = on. */
    screenshots: z.boolean().default(true),
    map: PageModelDraft.optional(),
    brain: BrainConfig.optional(),
    vision: VisionConfig.optional(),
    seo: SeoConfig.optional(),
  })
  .strict();
export type LeashFile = z.infer<typeof LeashFile>;

/** Runtime config. `map` is always filled after load. */
export const Config = z
  .object({
    url: z.string().url(),
    fence: Fence.optional(),
    intro: z.array(z.string()).default([]),
    skip: z.array(z.string().min(1)).default([]),
    writePolicy: WritePolicy.default("validationOnly"),
    /** Per-step screenshots. Omit = on. */
    screenshots: z.boolean().default(true),
    map: PageModelDraft,
    brain: BrainConfig.optional(),
    vision: VisionConfig.optional(),
    seo: SeoConfig.optional(),
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
