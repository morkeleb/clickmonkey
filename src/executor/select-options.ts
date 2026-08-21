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
