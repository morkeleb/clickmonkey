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

export function identityFromRunId(runId: string): { name: string; hue: number } {
  const n = digest(runId);
  const adjective = ADJECTIVES[n % ADJECTIVES.length]!;
  const animal = ANIMALS[Math.floor(n / ADJECTIVES.length) % ANIMALS.length]!;
  return { name: `${adjective}-${animal}`, hue: n % 360 };
}
