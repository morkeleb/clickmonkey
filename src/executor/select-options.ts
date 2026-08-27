import type { Locator as PwLocator } from "playwright";

export type LiveSelectOption = { value: string; label: string };

/** DOM signals for a painted list row. Used when the widget is not a native `<select>`. */
export type ListRowSnap = LiveSelectOption & {
  tag: string;
  role: string;
  disabled: boolean;
  ariaDisabled: boolean;
  pointerEvents: string;
  tabIndex: number;
  hasOwnClick: boolean;
};

const NON_ACTABLE_ROLES = new Set(["presentation", "none", "group", "heading", "separator", "label"]);

/**
 * Can this row be chosen? Standard: option / menuitem / `<option>` / button / link.
 * Custom: own click handler or tabindex, and not pointer-events:none / disabled.
 */
export function listRowIsActable(row: ListRowSnap): boolean {
  if (row.disabled || row.ariaDisabled) return false;
  const role = (row.role ?? "").toLowerCase();
  const tag = (row.tag ?? "").toLowerCase();
  const standard =
    role === "option" || role === "menuitem" || tag === "option" || tag === "button" || tag === "a";
  // Group labels use pointer-events:none. Standard options often do too — the
  // child is the hit target; clicking the option still selects.
  if (!standard && (row.pointerEvents ?? "").toLowerCase() === "none") return false;
  if (NON_ACTABLE_ROLES.has(role)) return false;
  if (/^h[1-6]$/.test(tag) || tag === "hr" || tag === "legend" || tag === "label") return false;
  if (standard) return true;
  if ((row.tabIndex ?? -1) >= 0) return true;
  return Boolean(row.hasOwnClick);
}

export function liveOptionsFromSnaps(snaps: readonly ListRowSnap[]): LiveSelectOption[] {
  return snaps
    .filter((s) => (s.label || s.value).trim() !== "" && listRowIsActable(s))
    .map((s) => ({ value: s.value, label: s.label }));
}

/** Native `<select>` or a harvested typeahead list — never Faker/catalog. */
export function isListedControl(field: { type?: string; options?: readonly unknown[] }): boolean {
  return field.type === "select" || Boolean(field.options && field.options.length > 0);
}

/** Enabled `<option>`s on a native select. Empty when the locator is not a `<select>`. */
export async function readSelectOptions(loc: PwLocator): Promise<LiveSelectOption[]> {
  return loc
    .locator("option")
    .evaluateAll((els) =>
      els.flatMap((el) => {
        const o = el as unknown as {
          disabled: boolean;
          value: string;
          label: string;
          textContent: string | null;
        };
        if (o.disabled) return [];
        return [{ value: o.value, label: (o.label || o.textContent || "").trim() }];
      }),
    )
    .catch(() => []);
}

export function matchSelectOption(
  options: readonly LiveSelectOption[],
  wanted: string,
): LiveSelectOption | undefined {
  const byValue = options.find((o) => o.value === wanted);
  if (byValue) return byValue;
  return options.find((o) => o.label === wanted);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `AK` in `Alaska (AK)`, not the `ak` inside `Dakota`. */
function hasToken(hay: string, needle: string): boolean {
  if (!needle) return false;
  return new RegExp(`(?:^|[^A-Za-z0-9])${escapeRe(needle)}(?:[^A-Za-z0-9]|$)`, "i").test(hay);
}

/** Typeahead lists: exact, case-insensitive, prefix, then a whole token in the label. */
export function matchListedOption(
  options: readonly LiveSelectOption[],
  wanted: string,
): LiveSelectOption | undefined {
  const exact = matchSelectOption(options, wanted);
  if (exact) return exact;
  const needle = wanted.trim().toLowerCase();
  if (!needle) return undefined;
  const ci = options.find((o) => o.label.toLowerCase() === needle || o.value.toLowerCase() === needle);
  if (ci) return ci;
  const prefix = options.find(
    (o) => o.label.toLowerCase().startsWith(needle) || o.value.toLowerCase().startsWith(needle),
  );
  if (prefix) return prefix;
  return options.find((o) => hasToken(o.label, needle) || hasToken(o.value, needle));
}

/** Skip seed/disabled rows when a healthier option exists. */
const SKIP_STATUS = /\b(draft|inactive|blacklisted|disabled|archived)\b/i;
const PREFER_STATUS = /\bactive\b/i;

function optionText(opt: LiveSelectOption): string {
  return `${opt.label} ${opt.value}`;
}

/**
 * Prefer Active (or unlabeled) rows; drop Draft/Blacklisted when anything else exists.
 * Used when the planned fill is not in the list — never invent a value.
 */
export function rankListedOptions(options: readonly LiveSelectOption[]): LiveSelectOption[] {
  const named = options.filter((o) => (o.label || o.value).trim() !== "");
  if (named.length === 0) return [];
  const usable = named.filter((o) => !SKIP_STATUS.test(optionText(o)));
  const pool = usable.length > 0 ? usable : named;
  const preferred = pool.filter((o) => PREFER_STATUS.test(optionText(o)));
  if (preferred.length === 0) return pool;
  const rest = pool.filter((o) => !preferred.includes(o));
  return [...preferred, ...rest];
}

/** Prefer a match for `wanted`; otherwise an Active listed row, else any listed row. */
export function pickListedOption(
  options: readonly LiveSelectOption[],
  wanted: string,
): LiveSelectOption | undefined {
  const hit = matchListedOption(options, wanted);
  if (hit) return hit;
  return rankListedOptions(options)[0];
}

/** Pick a real `<option>` value (or label if value is empty). Skips the placeholder `value=""`. */
export function pickSelectOption(
  options: readonly LiveSelectOption[] | undefined,
  rng: () => number,
): string | undefined {
  if (!options || options.length === 0) return undefined;
  const ranked = rankListedOptions(options.filter((o) => o.value.trim() !== ""));
  const pool = ranked.length > 0 ? ranked : rankListedOptions(options);
  if (pool.length === 0) return undefined;
  const preferred = pool.filter((o) => PREFER_STATUS.test(optionText(o)));
  const pickFrom = preferred.length > 0 ? preferred : pool;
  const chosen = pickFrom[Math.floor(rng() * pickFrom.length)]!;
  return chosen.value.trim() !== "" ? chosen.value : chosen.label;
}

/** Playwright `selectOption` query. Empty `value` is ambiguous — use the label. */
export function selectOptionQuery(
  match: LiveSelectOption,
): { value: string } | { label: string } {
  return match.value !== "" ? { value: match.value } : { label: match.label };
}

export function formatSelectOptionList(options: readonly LiveSelectOption[]): string {
  if (options.length === 0) return "(none)";
  return options.map((o) => o.label || o.value || '""').join(" / ");
}
