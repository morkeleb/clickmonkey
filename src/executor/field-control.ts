import type { Locator as PwLocator, Page } from "playwright";
import { textContainsNastyPayload } from "../brains/nasty.js";
import { oneLineBug } from "../schema/dsl.js";
import type { ShownField } from "../schema/view.js";
import { dateControlRejectedNonDate, dateFillValue } from "./date-mask.js";
import {
  formatSelectOptionList,
  isListedControl,
  matchSelectOption,
  pickSelectOption,
  readSelectOptions,
  selectOptionQuery,
  type LiveSelectOption,
} from "./select-options.js";
import {
  fillTypeahead,
  LISTED_CHIP_PROMPT,
  listedPeekMs,
  listedValueIsCommitted,
  looksLikeTypeahead,
  readTypeaheadOptions,
  readTypeaheadValue,
  SEARCH_PROBES,
  skipTypeaheadNoRows,
  typeaheadFieldLabel,
  typeaheadMissMessage,
} from "./typeahead.js";
import { actionDeadline, actionTimeoutMs, PEEK_TIMEOUT_MS, sliceTimeoutMs } from "./timeout.js";

export type FieldControlKind = "checkbox" | "select" | "typeahead" | "text";

export type FieldApply =
  | { ok: true; value: string; track: boolean }
  | { ok: false; message: string };

type FieldRef = {
  type?: string;
  id?: string;
  value?: string;
  required?: boolean;
  options?: readonly unknown[];
  constraints?: { placeholder?: string; htmlType?: string };
};

const TYPED_VALUE_TYPES = new Set(["number", "date", "datetime", "email", "password", "checkbox", "radio"]);

/** Number/date/email/password — type-in, never a listed-picker harvest. */
export function isTypedValueField(field: FieldRef | undefined): boolean {
  if (!field) return false;
  const t = (field.type ?? "").toLowerCase();
  if (TYPED_VALUE_TYPES.has(t)) return true;
  const html = (field.constraints?.htmlType ?? "").toLowerCase();
  return html === "number" || html === "date" || html === "datetime-local" || html === "email" || html === "password";
}

/**
 * Listed picker: native select/combobox, harvested options, FK `*id`, or a
 * Select/Search chip prompt. Not a vocabulary list of product field names.
 * Pass the full FieldRef — `{ id }` alone treats `accountid` as listed and
 * misses a Select/Search chip on `matter`.
 */
export function looksLikeListedPicker(field: FieldRef | undefined): boolean {
  if (!field) return false;
  if (isTypedValueField(field)) return false;
  if (field.type === "select" || field.type === "combobox") return true;
  if (isListedControl(field)) return true;
  const id = (field.id ?? "").toLowerCase();
  if (/id$/.test(id)) return true;
  // Form body `*_search` chips, not place/address/geo.
  if (/_search$/.test(id) && !/(place|address|geo|location)/.test(id)) return true;
  if (/(^|_)attorney(_?\d+)?$/.test(id)) return true;
  // Payment payee chips without a trailing `id` (`vendor`, `payee`). Not `matter` (often a name).
  if (/^(vendor|payee)$/.test(id)) return true;
  if (LISTED_CHIP_PROMPT.test((field.value ?? "").trim())) return true;
  if (LISTED_CHIP_PROMPT.test((field.constraints?.placeholder ?? "").trim())) return true;
  return false;
}

/** Typeahead/select leftovers need Escape. Plain text in a dialog must not. */
export function shouldCloseOverlaysAfterFill(field: FieldRef | undefined): boolean {
  return looksLikeListedPicker(field);
}

export type FieldControl = {
  kind: FieldControlKind;
  applies(field: FieldRef | undefined, typeahead: boolean): boolean;
  read(loc: PwLocator, field?: FieldRef): Promise<string>;
  empty(loc: PwLocator, field?: FieldRef): Promise<boolean>;
  expect(loc: PwLocator, field: FieldRef | undefined, wanted: string): Promise<boolean>;
  peekOptions(loc: PwLocator, page: Page): Promise<LiveSelectOption[]>;
  fill(loc: PwLocator, page: Page, value: string, widgetKey: string, field?: FieldRef): Promise<FieldApply>;
};

async function inputValue(loc: PwLocator, timeout = PEEK_TIMEOUT_MS): Promise<string> {
  return loc.inputValue({ timeout }).catch(() => "");
}

async function fieldPlaceholder(loc: PwLocator, timeoutMs = PEEK_TIMEOUT_MS): Promise<string> {
  return ((await loc.getAttribute("placeholder", { timeout: timeoutMs }).catch(() => null)) ?? "").trim();
}

/** Blank, leftover placeholder, or a Select/Search chip that was never chosen. */
export function liveLooksEmpty(live: string, placeholder?: string | null): boolean {
  const v = live.trim();
  if (!v) return true;
  if (LISTED_CHIP_PROMPT.test(v)) return true;
  const ph = (placeholder ?? "").trim();
  return Boolean(ph) && v === ph;
}

/**
 * After a listed fill: committed row, optional empty skip, or required miss.
 * A chip still showing Select/Search is empty — never `ok` with that prompt.
 */
export function listedFillResult(opts: {
  wanted: string;
  live: string;
  listed: boolean;
  required?: boolean;
  widgetKey: string;
  label?: string;
  placeholder?: string;
}): FieldApply {
  const committed = listedValueIsCommitted(opts.live, opts.placeholder)
    ? opts.live.replace(/\s+/g, " ").trim()
    : "";
  if (opts.wanted === "") return { ok: true, value: committed, track: false };
  if (!committed) {
    if (skipTypeaheadNoRows(opts.wanted, [], opts.listed, opts.required)) {
      return { ok: true, value: "", track: false };
    }
    return {
      ok: false,
      message: typeaheadMissMessage({
        widgetKey: opts.widgetKey,
        label: opts.label,
        wanted: opts.wanted,
      }),
    };
  }
  return { ok: true, value: committed, track: true };
}

/** Chip still showing the 1–2 char probe after a row click — keep the picked label. */
export function listedLiveOrPicked(live: string, picked: string, placeholder?: string): string {
  if (listedValueIsCommitted(live, placeholder)) return live.replace(/\s+/g, " ").trim();
  if (picked && listedValueIsCommitted(picked, placeholder)) return picked.replace(/\s+/g, " ").trim();
  return live;
}

async function peekHtmlType(loc: PwLocator, timeoutMs = PEEK_TIMEOUT_MS): Promise<string> {
  return ((await loc.getAttribute("type", { timeout: timeoutMs }).catch(() => null)) ?? "").trim();
}

/** Map Field has no live value/placeholder — listed chips live on the DOM. */
export async function enrichFieldRef(
  loc: PwLocator,
  field: FieldRef | undefined,
  widgetKey: string,
  timeoutMs = PEEK_TIMEOUT_MS,
): Promise<FieldRef> {
  const id = field?.id ?? widgetKey.split(".").pop() ?? "";
  const placeholder = field?.constraints?.placeholder?.trim() || (await fieldPlaceholder(loc, timeoutMs));
  const htmlType = field?.constraints?.htmlType?.trim() || (await peekHtmlType(loc, timeoutMs));
  const live = (await readTypeaheadValue(loc, timeoutMs)) || (await inputValue(loc, timeoutMs));
  const value = field?.value?.trim() || live;
  return {
    ...field,
    id,
    value,
    ...(field?.type !== undefined ? { type: field.type } : {}),
    ...(field?.required !== undefined ? { required: field.required } : {}),
    constraints: {
      ...field?.constraints,
      ...(placeholder ? { placeholder } : {}),
      ...(htmlType ? { htmlType } : {}),
    },
  };
}

async function finishListedFill(
  loc: PwLocator,
  live: string,
  opts: {
    wanted: string;
    listed: boolean;
    required?: boolean;
    widgetKey: string;
    placeholder?: string;
  },
): Promise<FieldApply> {
  const result = listedFillResult({ ...opts, live });
  if (result.ok) return result;
  const label = (await typeaheadFieldLabel(loc, opts.widgetKey)).trim();
  return listedFillResult({ ...opts, live, label });
}

export function textFillMissMessage(widgetKey: string, wanted: string, placeholder: string): string {
  return `${widgetKey} did not accept ${JSON.stringify(wanted)} (still ${placeholder.trim() || "empty"})`;
}

/** Date mask or catalog junk that did not stick. The control worked; not a fill miss. */
export function skipTextFillMiss(
  wanted: string,
  live: string,
  placeholder: string,
  htmlType?: string,
): boolean {
  if (!liveLooksEmpty(live, placeholder)) return false;
  return dateControlRejectedNonDate(wanted, { placeholder, htmlType }) || textContainsNastyPayload(wanted);
}

const CHECKBOX: FieldControl = {
  kind: "checkbox",
  applies(field) {
    return field?.type === "checkbox";
  },
  async read(loc) {
    return (await loc.isChecked({ timeout: PEEK_TIMEOUT_MS }).catch(() => false)) ? "true" : "false";
  },
  async empty(loc) {
    return !(await loc.isChecked({ timeout: PEEK_TIMEOUT_MS }).catch(() => false));
  },
  async expect(loc, _field, wanted) {
    const checked = await loc.isChecked({ timeout: PEEK_TIMEOUT_MS }).catch(() => false);
    const wantChecked = wanted !== "" && wanted !== "false";
    return checked === wantChecked;
  },
  async peekOptions() {
    return [];
  },
  async fill(loc, page, value) {
    const ms = actionTimeoutMs(page);
    if (value === "" || value === "false") await loc.uncheck({ timeout: ms });
    else await loc.check({ timeout: ms });
    const live = (await loc.isChecked({ timeout: PEEK_TIMEOUT_MS }).catch(() => value !== "" && value !== "false"))
      ? "true"
      : "false";
    return { ok: true, value: live, track: false };
  },
};

const SELECT: FieldControl = {
  kind: "select",
  applies(field, typeahead) {
    if (typeahead) return false;
    return field?.type === "select";
  },
  read: (loc) => inputValue(loc, PEEK_TIMEOUT_MS),
  async empty(loc) {
    return (await inputValue(loc, PEEK_TIMEOUT_MS)).trim() === "";
  },
  async expect(loc, _field, wanted) {
    return (await inputValue(loc, PEEK_TIMEOUT_MS)) === wanted;
  },
  peekOptions: (loc) => readSelectOptions(loc),
  async fill(loc, page, value, widgetKey, field) {
    const options = await readSelectOptions(loc);
    if (options.length === 0) {
      const typeahead = await fillTypeahead(loc, page, value, widgetKey, {
        force: true,
        required: field?.required,
      });
      if (typeahead.handled && typeahead.failure) return { ok: false, message: typeahead.failure.message };
      if (typeahead.handled) {
        const live = await readTypeaheadValue(loc, listedPeekMs(page));
        return finishListedFill(loc, live, {
          wanted: value,
          listed: true,
          required: field?.required,
          widgetKey,
          placeholder: field?.constraints?.placeholder,
        });
      }
      return {
        ok: false,
        message: `select ${widgetKey} has no option ${JSON.stringify(value)} (options: ${formatSelectOptionList(options)})`,
      };
    }
    const match = matchSelectOption(options, value);
    if (!match) {
      return {
        ok: false,
        message: `select ${widgetKey} has no option ${JSON.stringify(value)} (options: ${formatSelectOptionList(options)})`,
      };
    }
    await loc.selectOption(selectOptionQuery(match), { timeout: actionTimeoutMs(page) });
    return { ok: true, value: match.value || match.label, track: false };
  },
};

const TYPEAHEAD: FieldControl = {
  kind: "typeahead",
  applies(field, typeahead) {
    if (isTypedValueField(field)) return false;
    return typeahead || field?.type === "combobox" || looksLikeListedPicker(field);
  },
  async read(loc, field) {
    const live = await readTypeaheadValue(loc);
    if (!listedValueIsCommitted(live, field?.constraints?.placeholder)) return "";
    return live;
  },
  async empty(loc, field) {
    const live = await readTypeaheadValue(loc);
    return !listedValueIsCommitted(live, field?.constraints?.placeholder);
  },
  async expect(loc, field, wanted) {
    const live = await readTypeaheadValue(loc);
    if (!wanted) return !listedValueIsCommitted(live, field?.constraints?.placeholder);
    return live === wanted || live.toLowerCase().includes(wanted.trim().toLowerCase());
  },
  peekOptions: (loc, page) => readTypeaheadOptions(loc, page), // attached rows only; never open/probe/CDP
  async fill(loc, page, value, widgetKey, field) {
    const peek = listedPeekMs(page);
    const liveField = await enrichFieldRef(loc, field, widgetKey, peek);
    const listed = looksLikeListedPicker(liveField);
    const typeahead = await fillTypeahead(loc, page, value, widgetKey, {
      force: listed,
      required: liveField.required,
    });
    if (!typeahead.handled) return TEXT.fill(loc, page, value, widgetKey, liveField);
    if (typeahead.failure) return { ok: false, message: typeahead.failure.message };
    const live = await readTypeaheadValue(loc, peek);
    return finishListedFill(loc, listedLiveOrPicked(live, typeahead.value, liveField.constraints?.placeholder), {
      wanted: value,
      listed,
      required: liveField.required,
      widgetKey,
      placeholder: liveField.constraints?.placeholder,
    });
  },
};

const TEXT: FieldControl = {
  kind: "text",
  applies() {
    return true;
  },
  async read(loc, field) {
    const raw = await inputValue(loc, 0);
    const placeholder = await fieldPlaceholder(loc);
    if (liveLooksEmpty(raw, placeholder)) return "";
    if (field?.type === "password") return raw ? "••••" : "";
    return raw;
  },
  async empty(loc) {
    const live = await inputValue(loc, PEEK_TIMEOUT_MS);
    const placeholder = await fieldPlaceholder(loc);
    return liveLooksEmpty(live, placeholder);
  },
  async expect(loc, _field, wanted) {
    return (await inputValue(loc, PEEK_TIMEOUT_MS)) === wanted;
  },
  async peekOptions() {
    return [];
  },
  async fill(loc, page, value, widgetKey) {
    const deadline = actionDeadline(page);
    const placeholder = await fieldPlaceholder(loc);
    const htmlType = ((await loc.getAttribute("type", { timeout: PEEK_TIMEOUT_MS }).catch(() => null)) ?? "").toLowerCase();
    const typed = dateFillValue(value, { placeholder, htmlType });
    try {
      const clearMs = sliceTimeoutMs(deadline);
      if (clearMs <= 0) return { ok: true, value: "", track: false };
      await loc.fill("", { timeout: clearMs });
      if (typed !== "") {
        const fillMs = sliceTimeoutMs(deadline);
        if (fillMs <= 0) return { ok: true, value: "", track: false };
        await loc.fill(typed, { timeout: fillMs });
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : `${widgetKey} fill failed`;
      if (/Cannot type text into input\[type=number\]/i.test(raw)) {
        return { ok: true, value: "", track: false };
      }
      return { ok: false, message: oneLineBug(raw) || `${widgetKey} fill failed` };
    }
    const blurMs = sliceTimeoutMs(deadline);
    if (blurMs > 0) {
      await loc
        .evaluate((el) => {
          const node = el as { blur?: () => void };
          node.blur?.();
        }, undefined, { timeout: blurMs })
        .catch(() => undefined);
    }
    const live = await loc.inputValue({ timeout: PEEK_TIMEOUT_MS }).catch(() => typed);
    if (value !== "" && skipTextFillMiss(typed, live ?? "", placeholder, htmlType)) {
      return { ok: true, value: "", track: false };
    }
    if (value !== "" && liveLooksEmpty(live ?? "", placeholder)) {
      return { ok: false, message: textFillMissMessage(widgetKey, value, placeholder) };
    }
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
  const peek = page ? listedPeekMs(page) : PEEK_TIMEOUT_MS;
  const typeahead = Boolean(page && (await looksLikeTypeahead(loc, peek)));
  return FIELD_CONTROLS.find((c) => c.applies(field, typeahead)) ?? TEXT;
}

export async function applyFieldFill(
  loc: PwLocator,
  page: Page,
  field: FieldRef | undefined,
  value: string,
  widgetKey: string,
): Promise<FieldApply> {
  const peek = listedPeekMs(page);
  const liveField = await enrichFieldRef(loc, field, widgetKey, peek);
  const control = await resolveFieldControl(loc, page, liveField);
  const listed = looksLikeListedPicker(liveField);
  // Number/date/email stay on TEXT.fill — listed harvest would sit for `--timeout`.
  if (isTypedValueField(liveField) || (control.kind === "text" && !listed)) {
    return control.fill(loc, page, value, widgetKey, liveField);
  }
  // Native <select> stays on SELECT.fill — not typeahead skip-or-click.
  if (control.kind === "typeahead" || (listed && control.kind !== "select")) {
    const typeahead = await fillTypeahead(loc, page, value, widgetKey, {
      force: listed,
      required: liveField.required,
    });
    if (typeahead.handled && typeahead.failure) return { ok: false, message: typeahead.failure.message };
    if (typeahead.handled) {
      const live = await readTypeaheadValue(loc, peek);
      return finishListedFill(loc, listedLiveOrPicked(live, typeahead.value, liveField.constraints?.placeholder), {
        wanted: value,
        listed,
        required: liveField.required,
        widgetKey,
        placeholder: liveField.constraints?.placeholder,
      });
    }
  }
  return control.fill(loc, page, value, widgetKey, liveField);
}

export { isListedControl } from "./select-options.js";

/** Short typeahead query so fillTypeahead harvests a row. Never Faker/catalog. */
const LISTED_PROBE_COUNT = 2;

function listedSearchProbe(rng: () => number): string {
  return SEARCH_PROBES[Math.floor(rng() * LISTED_PROBE_COUNT)]!;
}

/** What unleash/nasty should type. `undefined` means type-in (Faker or catalog). */
export function planControlFill(field: ShownField, rng: () => number, emptyOk: boolean): string | undefined {
  if (field.type === "checkbox") return rng() < 0.5 ? "true" : "false";
  if (isListedControl(field)) {
    if (field.type === "select") {
      const picked = pickSelectOption(field.options, rng);
      if (picked === undefined) return emptyOk ? "" : undefined;
      const hasEmpty = field.options?.some((o) => o.value === "") ?? false;
      if (emptyOk && hasEmpty && rng() < 0.5) return "";
      return picked;
    }
    if (emptyOk && rng() < 0.5) return "";
    return pickSelectOption(field.options, rng);
  }
  // FK / Select-chip with no harvested options — still a listed picker.
  // Never plan blank: an empty chip loops the burst while still looking empty.
  if (looksLikeListedPicker(field)) {
    return listedSearchProbe(rng);
  }
  return undefined;
}
