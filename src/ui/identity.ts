import { createHash } from "node:crypto";

const ADJECTIVES = [
  "amber",
  "brave",
  "copper",
  "dusk",
  "ember",
  "flint",
  "golden",
  "harbor",
  "ivory",
  "jade",
  "keel",
  "lunar",
  "maple",
  "north",
  "olive",
  "pearl",
  "quartz",
  "river",
  "sable",
  "tide",
  "umber",
  "violet",
  "willow",
  "xenon",
  "yellow",
  "zephyr",
  "ash",
  "brisk",
  "cedar",
  "delta",
  "echo",
  "frost",
];

const ANIMALS = [
  "otter",
  "heron",
  "fox",
  "lynx",
  "wren",
  "badger",
  "crane",
  "drake",
  "elk",
  "finch",
  "gull",
  "hare",
  "ibis",
  "jay",
  "kite",
  "lark",
  "mink",
  "newt",
  "owl",
  "puma",
  "quail",
  "rook",
  "seal",
  "tern",
  "urchin",
  "vole",
  "wolf",
  "yak",
  "zebra",
  "asp",
  "bear",
  "crow",
];

function digest(runId: string): number {
  const buf = createHash("sha1").update(runId).digest();
  return buf.readUInt32BE(0);
}

/** 12 slots around the wheel — enough for a watch.sh pack, far apart in HSL. */
export const HUE_SLOTS = 12;

export function hueDistance(a: number, b: number): number {
  const wrap = (h: number) => ((h % 360) + 360) % 360;
  const d = Math.abs(wrap(a) - wrap(b));
  return Math.min(d, 360 - d);
}

function slots(): number[] {
  const step = Math.round(360 / HUE_SLOTS);
  return Array.from({ length: HUE_SLOTS }, (_, i) => i * step);
}

/**
 * Next live-monkey hue: farthest on the wheel from hues already taken.
 * `preferred` (hash of run id) only breaks ties.
 */
export function pickDistinctHue(taken: readonly number[], preferred = 0): number {
  const candidates = slots();
  const score = (h: number): number => {
    if (taken.length === 0) return -hueDistance(h, preferred);
    return Math.min(...taken.map((t) => hueDistance(h, t)));
  };
  let best = candidates[0]!;
  let bestScore = -Infinity;
  for (const h of candidates) {
    const s = score(h);
    if (s > bestScore || (s === bestScore && hueDistance(h, preferred) < hueDistance(best, preferred))) {
      bestScore = s;
      best = h;
    }
  }
  if (taken.length < HUE_SLOTS) return best;
  for (let h = 0; h < 360; h++) {
    const s = Math.min(...taken.map((t) => hueDistance(h, t)));
    if (s > bestScore) {
      bestScore = s;
      best = h;
    }
  }
  return best;
}

export function identityFromRunId(runId: string): { name: string; hue: number } {
  const n = digest(runId);
  const adjective = ADJECTIVES[n % ADJECTIVES.length]!;
  const animal = ANIMALS[Math.floor(n / ADJECTIVES.length) % ANIMALS.length]!;
  return { name: `${adjective}-${animal}`, hue: n % 360 };
}
