import type { View } from "../schema/view.js";

export interface BrainDecision {
  line: string;
  note?: string;
}

export interface BrainContext {
  view: View;
  stepsUsed: number;
  last?: { ok: boolean; finding?: string };
  charter?: string;
  notes?: string[];
}

export interface Brain {
  name: string;
  decide(ctx: BrainContext): Promise<BrainDecision> | BrainDecision;
}
