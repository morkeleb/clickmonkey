import type { Locator as PwLocator, Page } from "playwright";
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

export type WatchedRequest = {
  url: string;
  method?: string;
  postData?: string | null;
};

const MIN_SENT_NEEDLE = 3;

/** True when a write-like request URL or body includes this filled value. */
export function fillValueInRequest(value: string, url: string, postData?: string | null): boolean {
  const needle = value.trim();
  if (needle.length < MIN_SENT_NEEDLE) return false;
  const body = postData ?? "";
  if (url.includes(needle) || body.includes(needle)) return true;
  let encoded = needle;
  try {
    encoded = encodeURIComponent(needle);
  } catch {
    encoded = needle;
  }
  if (encoded !== needle && (url.includes(encoded) || body.includes(encoded))) return true;
  const plus = encoded.replace(/%20/g, "+");
  if (plus !== encoded && (url.includes(plus) || body.includes(plus))) return true;
  try {
    const asJson = JSON.stringify(needle);
    if (body.includes(asJson)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function requestCarriesFill(requests: readonly WatchedRequest[], value: string): boolean {
  return requests.some((r) => fillValueInRequest(value, r.url, r.postData));
}

export function requestLooksLikeWrite(req: WatchedRequest): boolean {
  const method = (req.method ?? "").toUpperCase();
  if (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE") return true;
  return Boolean(req.postData);
}

/** WCAG 3.3.1: Save stayed put with no write and no accessible invalid. */
export const SILENT_SUBMIT_MESSAGE =
  "Save did not submit the form: no navigation, no write request, and no invalid fields were shown";

export function isSilentSubmitMessage(message: string): boolean {
  return /did not submit the form: no navigation, no write request, and no invalid fields/i.test(
    message,
  );
}

const UNFILLED_VALUE = /^(select|choose|pick|search)\b/i;

/** Blank, password mask, or a leftover Select/Search chip — not a committed value. */
export function fillValueLooksUnfilled(value: string): boolean {
  const v = value.trim();
  if (!v || v === "••••") return true;
  return UNFILLED_VALUE.test(v);
}

/** True when a submit click left the user with no send, no leave, and no invalid marks. */
export function shouldReportSilentSubmit(opts: {
  urlChanged: boolean;
  submitVisible: boolean;
  requests: readonly WatchedRequest[];
  validity: readonly FieldValidity[];
  /** Listed/required fills that never stuck — incomplete walk, not a silent Save. */
  trackedFills?: readonly { value: string }[];
}): boolean {
  if (opts.urlChanged || !opts.submitVisible) return false;
  if (opts.requests.some(requestLooksLikeWrite)) return false;
  if (opts.validity.some(fieldLooksInvalid)) return false;
  if (opts.trackedFills?.some((f) => fillValueLooksUnfilled(f.value))) return false;
  return true;
}

export function validationMissesToReport(opts: {
  unmarked: TrackedFill[];
  gone: TrackedFill[];
  requests: readonly WatchedRequest[];
}): TrackedFill[] {
  const writes = opts.requests.filter(requestLooksLikeWrite);
  const sent = opts.unmarked.filter((f) => {
    if (requestCarriesFill(opts.requests, f.value)) return true;
    return f.value.trim().length < MIN_SENT_NEEDLE && writes.length > 0;
  });
  return [...sent, ...opts.gone];
}

/** Any visible field the browser already marked invalid (including ones we never filled). */
export async function pageHasBlockingInvalid(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      const g = globalThis as unknown as {
        document: {
          querySelector(sel: string): unknown;
          querySelectorAll(sel: string): ArrayLike<{
            validity?: { valid?: boolean };
            form?: { noValidate?: boolean } | null;
          }>;
        };
      };
      if (g.document.querySelector('[aria-invalid="true"]')) return true;
      const nodes = g.document.querySelectorAll("input, select, textarea");
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]!;
        if (node.validity?.valid !== false) continue;
        if (node.form?.noValidate) continue;
        return true;
      }
      return false;
    })
    .catch(() => false);
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
    return undefined;
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
  const junk = latestTrackedFill(fills, true);
  const last = latestTrackedFill(fills, false);
  const match = fromStep
    ? fills?.find((f) => f.surface === fromStep.surface && f.id === fromStep.id)
    : (junk ?? last);
  const surface = fromStep?.surface ?? match?.surface;
  const id = fromStep?.id ?? match?.id;
  if (!surface || !id) return undefined;
  const value = fromStep?.value ?? match?.value ?? "";
  const sameValue = Boolean(fromStep && match && match.value === fromStep.value);
  const shouldInvalid = fromStep
    ? sameValue
      ? Boolean(match?.shouldInvalid)
      : fillShouldLookInvalid({ id: fromStep.id }, fromStep.value)
    : Boolean(match?.shouldInvalid);
  return {
    field: `${surface}.${id}`,
    value: clipFillValue(value),
    markedInvalid: match && (!fromStep || sameValue) ? fieldLooksInvalid(match.validity) : undefined,
    shouldInvalid,
  };
}
