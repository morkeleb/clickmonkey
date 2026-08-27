import type { LocatorBy } from "../schema/locator.js";

/** Stable widget ids: letter-first, alnum/underscore only. */
export function slug(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/[^a-z0-9]/g, "_");
  if (s === "") return "widget";
  if (/^[0-9]/.test(s)) return `id_${s}`;
  return s;
}

/** "Active tabs: 12" is the same control as "Active tabs". */
export function stableAccName(name: string): string {
  const trimmed = name.trim();
  if (/^active tabs\b/i.test(trimmed)) return "Active tabs";
  return trimmed;
}

/** Overflow-tab chrome (`active_tabs`, `active_tabs_12`) — one control, not a map room. */
export function isActiveTabsSurfaceId(id: string): boolean {
  return id === "active_tabs" || /^active_tabs_/.test(id);
}

export function mintedBase(c: {
  by: LocatorBy;
  value: string;
  name?: string;
}): string {
  if (c.by === "role") {
    return c.name ? `${slug(c.value)}_${slug(stableAccName(c.name))}` : slug(c.value);
  }
  return slug(c.value);
}

/** Suffix _2, _3 only when another locator already claimed this slug. */
export function uniqueMint(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  while (used.has(`${base}_${n}`)) n += 1;
  const id = `${base}_${n}`;
  used.add(id);
  return id;
}
