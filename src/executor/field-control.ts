import type { Locator as PwLocator, Page } from "playwright";
import { oneLineBug } from "../schema/dsl.js";
import type { ShownField } from "../schema/view.js";
import {
  formatSelectOptionList,
  matchSelectOption,
  pickSelectOption,
  readSelectOptions,
  selectOptionQuery,
  type LiveSelectOption,
} from "./select-options.js";
import { fillTypeahead, looksLikeTypeahead, readTypeaheadOptions } from "./typeahead.js";

export type FieldControlKind = "checkbox" | "select" | "typeahead" | "text";

export type FieldApply =
  | { ok: true; value: string; track: boolean }
  | { ok: false; message: string };

type FieldRef = { type?: string };

export type FieldControl = {
  kind: FieldControlKind;
  applies(field: FieldRef | undefined, typeahead: boolean): boolean;
  read(loc: PwLocator, field?: FieldRef): Promise<string>;
  empty(loc: PwLocator, field?: FieldRef): Promise<boolean>;
  expect(loc: PwLocator, field: FieldRef | undefined, wanted: string): Promise<boolean>;
  peekOptions(loc: PwLocator, page: Page): Promise<LiveSelectOption[]>;
  fill(loc: PwLocator, page: Page, value: string, widgetKey: string): Promise<FieldApply>;
};

async function inputValue(loc: PwLocator, timeout?: number): Promise<string> {
  return loc.inputValue(timeout !== undefined ? { timeout } : undefined).catch(() => "");
}

const CHECKBOX: FieldControl = {
  kind: "checkbox",
  applies(field) {
    return field?.type === "checkbox";
  },
  async read(loc) {
    return (await loc.isChecked({ timeout: 0 }).catch(() => false)) ? "true" : "false";
  },
  async empty(loc) {
    return !(await loc.isChecked().catch(() => false));
  },
  async expect(loc, _field, wanted) {
    const checked = await loc.isChecked().catch(() => false);
    const wantChecked = wanted !== "" && wanted !== "false";
    return checked === wantChecked;
  },
  async peekOptions() {
    return [];
  },
  async fill(loc, _page, value) {
    if (value === "" || value === "false") await loc.uncheck();
    else await loc.check();
    const live = (await loc.isChecked().catch(() => value !== "" && value !== "false")) ? "true" : "false";
    return { ok: true, value: live, track: false };
  },
};

const SELECT: FieldControl = {
  kind: "select",
  applies(field) {
    return field?.type === "select";
  },
  read: (loc) => inputValue(loc, 0),
  async empty(loc) {
    return (await inputValue(loc)).trim() === "";
  },
  async expect(loc, _field, wanted) {
    return (await inputValue(loc)) === wanted;
  },
  peekOptions: (loc) => readSelectOptions(loc),
  async fill(loc, _page, value, widgetKey) {
    const options = await readSelectOptions(loc);
    const match = matchSelectOption(options, value);
    if (!match) {
      return {
        ok: false,
        message: `select ${widgetKey} has no option ${JSON.stringify(value)} (options: ${formatSelectOptionList(options)})`,
      };
    }
    await loc.selectOption(selectOptionQuery(match), { timeout: 2_000 });
    return { ok: true, value: match.value || match.label, track: false };
  },
};

const TYPEAHEAD: FieldControl = {
  kind: "typeahead",
  applies(_field, typeahead) {
    return typeahead;
  },
  read: (loc) => inputValue(loc, 0),
  async empty(loc) {
    return (await inputValue(loc)).trim() === "";
  },
  async expect(loc, _field, wanted) {
    return (await inputValue(loc)) === wanted;
  },
  peekOptions: (loc, page) => readTypeaheadOptions(loc, page),
  async fill(loc, page, value, widgetKey) {
    const typeahead = await fillTypeahead(loc, page, value, widgetKey);
    if (!typeahead.handled) return TEXT.fill(loc, page, value, widgetKey);
    if (typeahead.failure) return { ok: false, message: typeahead.failure.message };
    const live = await loc.inputValue().catch(() => typeahead.value);
    return { ok: true, value: live, track: true };
  },
};

const TEXT: FieldControl = {
  kind: "text",
  applies() {
    return true;
  },
  async read(loc, field) {
    const raw = await inputValue(loc, 0);
    if (field?.type === "password") return raw ? "••••" : "";
    return raw;
  },
  async empty(loc) {
    return (await inputValue(loc)).trim() === "";
  },
  async expect(loc, _field, wanted) {
    return (await inputValue(loc)) === wanted;
  },
  async peekOptions() {
    return [];
  },
  async fill(loc, _page, value, widgetKey) {
    try {
      await loc.fill("");
      if (value !== "") await loc.fill(value);
    } catch (err) {
      const raw = err instanceof Error ? err.message : `${widgetKey} fill failed`;
      if (/Cannot type text into input\[type=number\]/i.test(raw)) {
        return { ok: true, value: "", track: false };
      }
      return { ok: false, message: oneLineBug(raw) || `${widgetKey} fill failed` };
    }
    await loc
      .evaluate((el) => {
        const node = el as { blur?: () => void };
        node.blur?.();
      })
      .catch(() => undefined);
    const live = await loc.inputValue().catch(() => value);
    return { ok: true, value: live, track: true };
  },
};

/** Shared fill/read/options for mapped fields. Order: checkbox, native select, typeahead, type-in. */
export const FIELD_CONTROLS: readonly FieldControl[] = [CHECKBOX, SELECT, TYPEAHEAD, TEXT];

export async function resolveFieldControl(
  loc: PwLocator,
  page: Page | undefined,
  field?: FieldRef,
): Promise<FieldControl> {
  const typeahead = Boolean(page && (await looksLikeTypeahead(loc)));
  return FIELD_CONTROLS.find((c) => c.applies(field, typeahead)) ?? TEXT;
}

export async function applyFieldFill(
  loc: PwLocator,
  page: Page,
  field: FieldRef | undefined,
  value: string,
  widgetKey: string,
): Promise<FieldApply> {
  const control = await resolveFieldControl(loc, page, field);
  return control.fill(loc, page, value, widgetKey);
}

/** Native `<select>` or a harvested typeahead list — never Faker/catalog. */
export function isListedControl(field: { type?: string; options?: readonly unknown[] }): boolean {
  return field.type === "select" || Boolean(field.options && field.options.length > 0);
}

/** What unleash/nasty should type. `undefined` means type-in (Faker or catalog). */
export function planControlFill(field: ShownField, rng: () => number, emptyOk: boolean): string | undefined {
  if (field.type === "checkbox") return rng() < 0.5 ? "true" : "false";
  if (!isListedControl(field)) return undefined;
  if (field.type === "select") {
    const hasEmpty = field.options?.some((o) => o.value === "") ?? false;
    if (emptyOk && hasEmpty && rng() < 0.5) return "";
    return pickSelectOption(field.options, rng) ?? "";
  }
  if (emptyOk && rng() < 0.5) return "";
  return pickSelectOption(field.options, rng);
}
