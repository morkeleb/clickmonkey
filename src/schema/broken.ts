import { z } from "zod";

export const BrokenEntry = z
  .object({
    path: z.string().min(1),
    url: z.string().min(1),
    status: z.number().int(),
    foundAt: z.string().min(1),
    resourceType: z.enum(["document", "xhr", "fetch"]).optional(),
  })
  .strict();
export type BrokenEntry = z.infer<typeof BrokenEntry>;

/** Per-run `broken.json` — not the page map. */
export const BrokenReport = z
  .object({
    schemaVersion: z.literal(1),
    entries: z.array(BrokenEntry).default([]),
  })
  .strict();
export type BrokenReport = z.infer<typeof BrokenReport>;

export function emptyBrokenReport(): BrokenReport {
  return { schemaVersion: 1, entries: [] };
}

export function mergeBrokenReports(a: BrokenReport, b: BrokenReport): BrokenReport {
  const byKey = new Map<string, BrokenEntry>();
  for (const e of [...a.entries, ...b.entries]) {
    const key = `${e.status}\0${e.path}\0${e.resourceType ?? ""}`;
    if (!byKey.has(key)) byKey.set(key, e);
  }
  return {
    schemaVersion: 1,
    entries: [...byKey.values()].sort((x, y) => x.path.localeCompare(y.path)),
  };
}
