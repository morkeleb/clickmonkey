import { z } from "zod";
import { detectWalkerMode } from "../brains/walker-mode.js";
import { WalkerModeName } from "./fog.js";
import { formatView } from "../executor/view.js";
import { WritePolicy } from "./config.js";
import { Locator } from "./locator.js";
import { View } from "./view.js";

export const ExploreVisit = z
  .object({
    mode: WalkerModeName,
    formatted: z.string().min(1),
    ready: Locator.optional(),
    legalOpen: z.array(z.string()).default([]),
    shot: z.string().min(1).optional(),
    sight: z.string().min(1).optional(),
    writePolicy: WritePolicy.optional(),
    planLine: z.string().min(1).optional(),
    view: View,
  })
  .strict();
export type ExploreVisit = z.infer<typeof ExploreVisit>;

export function formatExploreVisit(opts: {
  view: View;
  ready?: Locator;
  legalOpen?: readonly string[];
  shot?: string;
  sight?: string;
  writePolicy?: WritePolicy;
  planLine?: string;
}): ExploreVisit {
  const mode = opts.view.mode ?? detectWalkerMode({ view: opts.view, stepsUsed: 0 }).name;
  const view = opts.view.mode ? opts.view : { ...opts.view, mode };
  return ExploreVisit.parse({
    mode,
    formatted: formatView(view),
    ...(opts.ready ? { ready: opts.ready } : {}),
    legalOpen: opts.legalOpen ? [...opts.legalOpen] : (opts.view.pages ?? []),
    ...(opts.shot ? { shot: opts.shot } : {}),
    ...(opts.sight ? { sight: opts.sight } : {}),
    ...(opts.writePolicy ? { writePolicy: opts.writePolicy } : {}),
    ...(opts.planLine ? { planLine: opts.planLine } : {}),
    view,
  });
}
