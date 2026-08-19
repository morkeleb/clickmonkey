import type { UiExplorePlan } from "../schema/ui.js";
import type { View } from "../schema/view.js";

export interface BrainDecision {
  line: string;
  note?: string;
  done?: boolean;
}

export interface BrainContext {
  view: View;
  stepsUsed: number;
  last?: { ok: boolean; finding?: string };
  charter?: string;
  notes?: string[];
  /** Last executed walk lines (oldest → newest). Used to refuse hop/close cycles. */
  recent?: string[];
  plan?: UiExplorePlan;
}

export interface Brain {
  name: string;
  decide(ctx: BrainContext): Promise<BrainDecision> | BrainDecision;
}
