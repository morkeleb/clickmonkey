import type { Locator as PwLocator, Page } from "playwright";
import { textContainsNastyPayload } from "../brains/nasty.js";
import { looksLikeSearchField } from "../brains/unleash.js";
import type { PageErrorFillCtx } from "../schema/finding.js";
import type { ShownFieldConstraints } from "../schema/view.js";

export type FieldValidity = {
  ariaInvalid: boolean;
  errorVisible: boolean;
  nativeInvalid: boolean;
};

export type TrackedFill = {
  surface: string;
  id: string;
  value: string;
  shouldInvalid: boolean;
  validity: FieldValidity;
};

const MAX_TRACKED_FILLS = 16;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

export function fieldLooksInvalid(v: FieldValidity): boolean {
  return v.ariaInvalid || v.errorVisible || v.nativeInvalid;
}

export async function readFieldValidity(
  pw: PwLocator,
  page: Page,
  fieldId: string,
): Promise<FieldValidity> {
  const ariaInvalid = (await pw.getAttribute("aria-invalid").catch(() => null)) === "true";
  const errorVisible = await page
    .getByTestId(`${fieldId}-error`)
    .isVisible()
    .catch(() => false);
  const nativeInvalid = await pw
    .evaluate((el) => {
      const node = el as { validity?: { valid?: boolean }; form?: { noValidate?: boolean } | null };
      if (node.validity?.valid !== false) return false;
      // novalidate still reports valueMissing/typeMismatch; that is not a visible error.
      if (node.form?.noValidate) return false;
      return true;
    })
    .catch(() => false);
  return { ariaInvalid, errorVisible, nativeInvalid };
}

function cmpConstraint(value: string, bound: string): number | undefined {
  const nv = Number(value);
  const nb = Number(bound);
  if (!Number.isNaN(nv) && !Number.isNaN(nb)) return nv - nb;
  if (value === bound) return 0;
  if (value < bound) return -1;
  if (value > bound) return 1;
  return 0;
}

function typedValueLooksWrong(html: string, value: string): boolean {
  if (html === "email" && !value.includes("@")) return true;
  if (html === "url" && !/^https?:\/\//i.test(value)) return true;
  if (html === "number" && Number.isNaN(Number(value))) return true;
  if (html === "date" && !DATE_RE.test(value)) return true;
  if (html === "time" && !TIME_RE.test(value)) return true;
  if ((html === "datetime-local" || html === "datetime") && !DATETIME_RE.test(value)) return true;
  return false;
}

export function fillShouldLookInvalid(
  field: { id: string; type?: string; required?: boolean; label?: string; constraints?: ShownFieldConstraints },
  value: string,
): boolean {
  if (looksLikeSearchField({ id: field.id, value, type: field.type === "checkbox" ? "checkbox" : "text", label: field.label })) {
    return false;
  }
  if (field.required && value.trim() === "") return true;
  if (textContainsNastyPayload(value)) return true;
  const html = (field.constraints?.htmlType ?? field.type ?? "").toLowerCase();
  if (value.trim() && typedValueLooksWrong(html, value)) return true;
  const pattern = field.constraints?.pattern;
  if (pattern && value.trim()) {
    try {
      if (!new RegExp(`^(?:${pattern})$`).test(value)) return true;
    } catch {
      /* ignore invalid pattern */
    }
  }
  const minLength = field.constraints?.minLength;
  if (minLength !== undefined && value.length > 0 && value.length < minLength) return true;
  const maxLength = field.constraints?.maxLength;
  if (maxLength !== undefined && value.length > maxLength) return true;
  if (value.trim()) {
    const min = field.constraints?.min;
    const max = field.constraints?.max;
    if (min) {
      const cmp = cmpConstraint(value, min);
      if (cmp !== undefined && cmp < 0) return true;
    }
    if (max) {
      const cmp = cmpConstraint(value, max);
      if (cmp !== undefined && cmp > 0) return true;
    }
  }
  return false;
}

export function clipFillValue(value: string, max = 80): string {
  const one = value.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
}

export function upsertTrackedFill(list: TrackedFill[] | undefined, rec: TrackedFill): TrackedFill[] {
  const next = list ? [...list] : [];
  const i = next.findIndex((f) => f.surface === rec.surface && f.id === rec.id);
  if (i >= 0) next[i] = rec;
  else next.push(rec);
  if (next.length > MAX_TRACKED_FILLS) next.splice(0, next.length - MAX_TRACKED_FILLS);
  return next;
}

export function rememberTrackedFill(
  state: { lastFill?: TrackedFill; lastFills?: TrackedFill[] },
  rec: TrackedFill,
): void {
  state.lastFills = upsertTrackedFill(state.lastFills, rec);
  state.lastFill = rec;
}

export function clearTrackedFills(state: { lastFill?: TrackedFill; lastFills?: TrackedFill[] }): void {
  state.lastFill = undefined;
  state.lastFills = undefined;
}

function latestTrackedFill(fills: TrackedFill[] | undefined, preferShouldInvalid: boolean): TrackedFill | undefined {
  if (!fills || fills.length === 0) return undefined;
  if (preferShouldInvalid) {
    for (let i = fills.length - 1; i >= 0; i--) {
      if (fills[i]?.shouldInvalid) return fills[i];
    }
  }
  return fills[fills.length - 1];
}

export function fillCtxForPageError(
  fills: TrackedFill[] | undefined,
  step?: { kind: string; surface?: string; id?: string; value?: string },
): PageErrorFillCtx | undefined {
  const fromStep =
    step?.kind === "fill" && step.surface && step.id
      ? { surface: step.surface, id: step.id, value: step.value ?? "" }
      : undefined;
  const match = fromStep
    ? fills?.find((f) => f.surface === fromStep.surface && f.id === fromStep.id)
    : latestTrackedFill(fills, true);
  const surface = fromStep?.surface ?? match?.surface;
  const id = fromStep?.id ?? match?.id;
  if (!surface || !id) return undefined;
  const sameValue = Boolean(fromStep && match && match.value === fromStep.value);
  return {
    field: `${surface}.${id}`,
    value: clipFillValue(fromStep?.value ?? match?.value ?? ""),
    markedInvalid: match && (!fromStep || sameValue) ? fieldLooksInvalid(match.validity) : undefined,
  };
}
