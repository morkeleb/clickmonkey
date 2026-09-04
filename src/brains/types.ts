import type { Page } from "../schema/page-model.js";
import type { UiExplorePlan } from "../schema/ui.js";
import type { View } from "../schema/view.js";
import type { WalkerJobName, WalkerModeName } from "../schema/fog.js";

export interface BrainDecision {
  line: string;
  /** Fill remaining empties then submit — run in order without re-deciding. */
  lines?: string[];
  note?: string;
  /** Observed good behaviour — not a finding. */
  good?: string;
  done?: boolean;
  mode?: WalkerModeName;
  /** Form hunt destination; playbook feeds this back as ctx.huntTarget. */
  huntTarget?: string;
}

export function decisionLines(d: BrainDecision): string[] {
  if (d.lines && d.lines.length > 0) return d.lines;
  const line = d.line.trim();
  return line ? [line] : [];
}

/** Mid-burst fills skip layout/axe/resize; the last line inspects. */
export function skipInspectForBurstLine(index: number, count: number): boolean {
  return count > 1 && index < count - 1;
}

export interface BrainContext {
  view: View;
  stepsUsed: number;
  last?: { ok: boolean; finding?: string };
  charter?: string;
  notes?: string[];
  /** Last executed walk lines (oldest → newest). Used to refuse hop/close cycles. */
  recent?: string[];
  /** Last clicks on this page (oldest → newest). Unleash skips a click key after two appearances. */
  recentClicks?: readonly string[];
  /** Click ids that did nothing on this page (same URL, stack, widgets). Never pick again here. */
  noopIds?: readonly string[];
  /** Times a map form (`page/surface`) was filled this run. Hunt deprioritises high counts. */
  formHits?: Readonly<Record<string, number>>;
  /** Forms this run already committed or gave up on. Hunt may leave even if still on the surface. */
  formSpent?: Readonly<Record<string, true>>;
  /** Field ids already filled this page-stay. Listed pickers are not retried while still empty. */
  fillTried?: Readonly<Record<string, true>>;
  /** Form hunt target (`page/surface`) the walker is walking toward. */
  huntTarget?: string;
  /** Pin unleash to this map page until submit leaves it (`--form`). */
  lockForm?: string;
  /** Remaining local steps after a submit that changed page. Hunt waits. */
  lootSteps?: number;
  /** Times this run stood on `page/surface`. map lifts unseen rooms first. */
  pageVisits?: Readonly<Record<string, number>>;
  /** Last-land ISO times by page id for this job (`page.fog` on the sitemap). */
  pageFog?: Readonly<Record<string, string>>;
  /** Last successful form work for this job, keyed `page/surface`. */
  formWork?: Readonly<Record<string, string>>;
  /** Last mode ISO times keyed `page/mode`. */
  modeFog?: Readonly<Record<string, string>>;
  /** map / unleash / nasty. Hunger uses this monkey's clock. */
  job?: WalkerJobName;
  plan?: UiExplorePlan;
  pages?: readonly Page[];
  /** Last vision assist note. Context only — never a command or widget id. */
  sight?: string;
  writePolicy?: "validationOnly" | "allow";
}

export interface Brain {
  name: string;
  decide(ctx: BrainContext): Promise<BrainDecision> | BrainDecision;
}
