import type { Locator as PwLocator } from "playwright";

export type LiveSelectOption = { value: string; label: string };

/** Enabled `<option>`s on a native select. Empty when the locator is not a `<select>`. */
export async function readSelectOptions(loc: PwLocator): Promise<LiveSelectOption[]> {
  return loc
    .locator("option")
    .evaluateAll((els) =>
      els.flatMap((el) => {
        const o = el as {
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

/** Prefer a match for `wanted`; otherwise any listed row. */
export function pickListedOption(
  options: readonly LiveSelectOption[],
  wanted: string,
): LiveSelectOption | undefined {
  const hit = matchListedOption(options, wanted);
  if (hit) return hit;
  return options.find((o) => (o.label || o.value).trim() !== "") ?? options[0];
}

/** Pick a real `<option>` value (or label if value is empty). Skips the placeholder `value=""`. */
export function pickSelectOption(
  options: readonly LiveSelectOption[] | undefined,
  rng: () => number,
): string | undefined {
  if (!options || options.length === 0) return undefined;
  const real = options.filter((o) => o.value.trim() !== "");
  const pool = real.length > 0 ? real : options.filter((o) => o.label.trim() !== "");
  if (pool.length === 0) return undefined;
  const chosen = pool[Math.floor(rng() * pool.length)]!;
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
