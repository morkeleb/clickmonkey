import type { Page } from "../schema/page-model.js";
import type { UiExplorePlan } from "../schema/ui.js";
import type { View } from "../schema/view.js";
import type { WalkerModeName } from "./walker-mode.js";

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
  /** Form hunt target (`page/surface`) the walker is walking toward. */
  huntTarget?: string;
  /** Remaining local steps after a submit that changed page. Hunt waits. */
  lootSteps?: number;
  /** Times this run stood on `page/surface`. Map scout lifts unseen rooms first. */
  pageVisits?: Readonly<Record<string, number>>;
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
