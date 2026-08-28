export type WcagLevel = "A" | "AA";
export type ReportChapter = "testability" | "accessibility" | "visual" | "quality";

/** Report / By chapter order: user-facing breakage first, team debt last. */
export const CHAPTER_ORDER = ["quality", "visual", "accessibility", "testability"] as const satisfies readonly ReportChapter[];

export type WcagEntry = {
  sc?: string;
  level?: WcagLevel;
  chapter: ReportChapter;
  title?: string;
};

export type OverflowViewport = "320" | "other";

export type ChapterExtras = {
  message?: string;
  where?: string;
  source?: string;
  /** Set after splitting overflow; never classify a mixed where as one SC. */
  viewport?: OverflowViewport;
};

const TESTABILITY = new Set([
  "opaqueControl",
  "unnamedDialog",
  "unlabeledField",
  "unnamedControl",
  "missingStableId",
  "noMain",
  "occludedWidget",
  "duplicateName",
  "unknownId",
  "unresolvedId",
  "driftId",
  "locatorAmbiguous",
]);

const VISUAL = new Set([
  "overlap",
  "overflow",
  "clip",
  "zIndex",
  "align",
  "scanline",
  "sparse",
  "contrast",
  "broken",
  "textOcclusion",
  "fontSize",
  "deadHash",
  "implicitSubmit",
  "noopener",
  "scrollPadding",
  "pointerEvents",
  "other",
]);

const QUALITY = new Set([
  "element-permitted-content",
  "attribute-misuse",
  "no-multiple-main",
  "aria-label-misuse",
  "attribute-allowed-values",
  "element-required-attributes",
  "no-dup-id",
  "close-order",
  "element-required-content",
  "void-content",
  "document-title-placeholder",
  "document-title-long",
  "document-title-same",
  "document-title-instance",
  "meta-description",
  "og-title",
  "og-description",
  "og-image",
  "og-url",
  "canonical",
  "console.error",
  "console.warning",
  "pageError",
  "notFound",
  "httpError",
  "serverRefusedSubmit",
  "acceptedInvalid",
  "throwInsteadOfInvalid",
  "expectFailed",
]);

/** Axe ids we emit (wcag2a/aa + 2.1) plus extras. Best-practice extras omit sc/level. */
export const A11Y = {
  "area-alt": { sc: "1.1.1", level: "A", chapter: "accessibility", title: "Non-text content" },
  "aria-allowed-attr": { sc: "4.1.2", level: "A", chapter: "accessibility", title: "Name, role, value" },
  "aria-braille-equivalent": { sc: "4.1.2", level: "A", chapter: "accessibility" },
  "aria-command-name": { sc: "4.1.2", level: "A", chapter: "accessibility" },
  "aria-conditional-attr": { sc: "4.1.2", level: "A", chapter: "accessibility" },
  "aria-deprecated-role": { sc: "4.1.2", level: "A", chapter: "accessibility" },
  "aria-hidden-body": { sc: "4.1.2", level: "A", chapter: "accessibility" },
  "aria-hidden-focus": { sc: "4.1.2", level: "A", chapter: "accessibility", title: "Name, role, value" },
  "aria-input-field-name": { sc: "4.1.2", level: "A", chapter: "accessibility" },
  "aria-meter-name": { sc: "1.1.1", level: "A", chapter: "accessibility" },
  "aria-progressbar-name": { sc: "1.1.1", level: "A", chapter: "accessibility" },
  "aria-prohibited-attr": { sc: "4.1.2", level: "A", chapter: "accessibility" },
  "aria-required-attr": { sc: "4.1.2", level: "A", chapter: "accessibility" },
  "aria-required-children": { sc: "1.3.1", level: "A", chapter: "accessibility", title: "Info and relationships" },
  "aria-required-parent": { sc: "1.3.1", level: "A", chapter: "accessibility", title: "Info and relationships" },
  "aria-roledescription": { sc: "4.1.2", level: "A", chapter: "accessibility" },
  "aria-roles": { sc: "4.1.2", level: "A", chapter: "accessibility" },
  "aria-tab-name": { sc: "4.1.2", level: "A", chapter: "accessibility" },
  "aria-toggle-field-name": { sc: "4.1.2", level: "A", chapter: "accessibility" },
  "aria-tooltip-name": { sc: "4.1.2", level: "A", chapter: "accessibility" },
  "aria-valid-attr-value": { sc: "4.1.2", level: "A", chapter: "accessibility" },
  "aria-valid-attr": { sc: "4.1.2", level: "A", chapter: "accessibility" },
  "audio-caption": { sc: "1.2.1", level: "A", chapter: "accessibility" },
  "autocomplete-valid": { sc: "1.3.5", level: "AA", chapter: "accessibility" },
  "avoid-inline-spacing": { sc: "1.4.12", level: "AA", chapter: "accessibility" },
  blink: { sc: "2.2.2", level: "A", chapter: "accessibility" },
  "button-name": { sc: "4.1.2", level: "A", chapter: "accessibility", title: "Name, role, value" },
  bypass: { sc: "2.4.1", level: "A", chapter: "accessibility", title: "Bypass blocks" },
  "color-contrast": { sc: "1.4.3", level: "AA", chapter: "accessibility", title: "Contrast" },
  "css-orientation-lock": { sc: "1.3.4", level: "AA", chapter: "accessibility" },
  "definition-list": { sc: "1.3.1", level: "A", chapter: "accessibility" },
  dlitem: { sc: "1.3.1", level: "A", chapter: "accessibility" },
  "document-title": { sc: "2.4.2", level: "A", chapter: "accessibility", title: "Page titled" },
  "duplicate-id-aria": { sc: "4.1.2", level: "A", chapter: "accessibility" },
  "form-field-multiple-labels": { sc: "3.3.2", level: "A", chapter: "accessibility" },
  "frame-focusable-content": { sc: "2.1.1", level: "A", chapter: "accessibility" },
  "frame-title-unique": { sc: "4.1.2", level: "A", chapter: "accessibility" },
  "frame-title": { sc: "4.1.2", level: "A", chapter: "accessibility" },
  "html-has-lang": { sc: "3.1.1", level: "A", chapter: "accessibility" },
  "html-lang-valid": { sc: "3.1.1", level: "A", chapter: "accessibility" },
  "html-xml-lang-mismatch": { sc: "3.1.1", level: "A", chapter: "accessibility" },
  "image-alt": { sc: "1.1.1", level: "A", chapter: "accessibility", title: "Non-text content" },
  "input-button-name": { sc: "4.1.2", level: "A", chapter: "accessibility" },
  "input-image-alt": { sc: "1.1.1", level: "A", chapter: "accessibility" },
  label: { sc: "4.1.2", level: "A", chapter: "accessibility", title: "Name, role, value" },
  "link-in-text-block": { sc: "1.4.1", level: "A", chapter: "accessibility" },
  "link-name": { sc: "4.1.2", level: "A", chapter: "accessibility", title: "Name, role, value" },
  list: { sc: "1.3.1", level: "A", chapter: "accessibility" },
  listitem: { sc: "1.3.1", level: "A", chapter: "accessibility", title: "Info and relationships" },
  marquee: { sc: "2.2.2", level: "A", chapter: "accessibility" },
  "meta-refresh": { sc: "2.2.1", level: "A", chapter: "accessibility" },
  "meta-viewport": { sc: "1.4.4", level: "AA", chapter: "accessibility" },
  "nested-interactive": { sc: "4.1.2", level: "A", chapter: "accessibility", title: "Name, role, value" },
  "no-autoplay-audio": { sc: "1.4.2", level: "A", chapter: "accessibility" },
  "object-alt": { sc: "1.1.1", level: "A", chapter: "accessibility" },
  "p-as-heading": { sc: "1.3.1", level: "A", chapter: "accessibility" },
  "role-img-alt": { sc: "1.1.1", level: "A", chapter: "accessibility" },
  "scrollable-region-focusable": { sc: "2.1.1", level: "A", chapter: "accessibility" },
  "select-name": { sc: "4.1.2", level: "A", chapter: "accessibility" },
  "server-side-image-map": { sc: "2.1.1", level: "A", chapter: "accessibility" },
  "summary-name": { sc: "4.1.2", level: "A", chapter: "accessibility" },
  "svg-img-alt": { sc: "1.1.1", level: "A", chapter: "accessibility" },
  "table-fake-caption": { sc: "1.3.1", level: "A", chapter: "accessibility" },
  "td-has-header": { sc: "1.3.1", level: "A", chapter: "accessibility" },
  "td-headers-attr": { sc: "1.3.1", level: "A", chapter: "accessibility" },
  "th-has-data-cells": { sc: "1.3.1", level: "A", chapter: "accessibility" },
  "valid-lang": { sc: "3.1.2", level: "AA", chapter: "accessibility" },
  "video-caption": { sc: "1.2.2", level: "A", chapter: "accessibility" },
  "skip-link": { sc: "2.4.1", level: "A", chapter: "accessibility", title: "Bypass blocks" },
  "label-content-name-mismatch": {
    sc: "2.5.3",
    level: "AA",
    chapter: "accessibility",
    title: "Label in name",
  },
  "aria-dialog-name": { sc: "4.1.2", level: "A", chapter: "accessibility", title: "Name, role, value" },
  tabindex: { chapter: "accessibility", title: "Best practice" },
  "heading-order": { chapter: "accessibility", title: "Best practice" },
  "empty-heading": { chapter: "accessibility", title: "Best practice" },
  "label-title-only": { chapter: "accessibility", title: "Best practice" },
  focusVisible: { sc: "2.4.7", level: "AA", chapter: "accessibility", title: "Focus visible" },
  focusObscured: { sc: "2.4.11", level: "AA", chapter: "accessibility", title: "Focus not obscured" },
  targetSize: { sc: "2.5.8", level: "AA", chapter: "accessibility", title: "Target size" },
  textSpacing: { sc: "1.4.12", level: "AA", chapter: "accessibility", title: "Text spacing" },
  silentSubmit: { sc: "3.3.1", level: "A", chapter: "accessibility", title: "Error Identification" },
  clickableNonWidget: { sc: "2.1.1", level: "A", chapter: "accessibility", title: "Keyboard" },
  keyboardTrap: { sc: "2.1.2", level: "A", chapter: "accessibility", title: "No keyboard trap" },
  focusOrder: { sc: "2.4.3", level: "A", chapter: "accessibility", title: "Focus order" },
} as const satisfies Record<string, WcagEntry>;

/**
 * DOM WCAG detectors we own. Everything else in `A11Y` is an axe-core rule id.
 * Reports name those `AXE {id}`, not `WCAG {sc}`.
 */
export const DOM_WCAG_RULES = [
  "focusVisible",
  "focusObscured",
  "targetSize",
  "textSpacing",
  "silentSubmit",
  "clickableNonWidget",
  "keyboardTrap",
  "focusOrder",
] as const;
export type DomWcagRule = (typeof DOM_WCAG_RULES)[number];
const DOM_WCAG_SET = new Set<string>(DOM_WCAG_RULES);

/**
 * Mapped if they fire, but axe-core keeps these experimental/deprecated off
 * and we do not enable them.
 */
const AXE_OFF = new Set([
  "css-orientation-lock",
  "p-as-heading",
  "table-fake-caption",
  "td-has-header",
  "aria-roledescription",
  "audio-caption",
]);

/** True for axe-core rule ids we map (including best-practice extras). */
export function isAxeRule(rule: string): boolean {
  return Object.hasOwn(A11Y, rule) && !DOM_WCAG_SET.has(rule);
}

/** Axe rule ids inspect actually runs (wcag2a/aa + 2.1 tags, plus extras). */
export function isEnabledAxeRule(rule: string): boolean {
  return isAxeRule(rule) && !AXE_OFF.has(rule);
}

export function enabledAxeRules(): string[] {
  return (Object.keys(A11Y) as Array<keyof typeof A11Y>).filter(isEnabledAxeRule) as string[];
}

const REFLOW_OVERFLOW: WcagEntry = {
  sc: "1.4.10",
  level: "AA",
  chapter: "accessibility",
  title: "Reflow",
};

const VIEWPORT_320 = /@\s*320px\b/i;

function overflowTag(text: string): OverflowViewport {
  return VIEWPORT_320.test(text) ? "320" : "other";
}

/** Split a merged overflow `where` into 320 vs 1280/375 buckets. */
export function splitOverflowByViewport(
  where?: string,
  message?: string,
): Array<{ viewport: OverflowViewport; where?: string; message: string }> {
  const msg = message ?? "";
  const parts = (where ?? "")
    .split(" · ")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return [{ viewport: overflowTag(msg), message: msg }];
  }
  const buckets = new Map<OverflowViewport, string[]>();
  for (const part of parts) {
    const vp = overflowTag(part);
    const list = buckets.get(vp) ?? [];
    list.push(part);
    buckets.set(vp, list);
  }
  return [...buckets.entries()].map(([viewport, wheres]) => ({
    viewport,
    where: wheres.join(" · "),
    message: msg,
  }));
}

const SILENT_SUBMIT = /did not submit the form: no navigation, no write request, and no invalid fields/i;
/** Write the UI sent; 400/409/422 is the server rejecting the value, not a missing page. */
const SERVER_REFUSED_SUBMIT = /\bHTTP\s+(400|409|422)\s+(POST|PUT|PATCH|DELETE)\b/i;
const ACCEPTED_INVALID =
  /accepted empty|did not catch junk|did not catch this input|accepted a blank required|accepted input that should have been rejected/i;
const THROW_INSTEAD_OF_INVALID = /validation is missing|junk value that crashes/i;

/** Save stayed put with no write and no accessible invalid (WCAG 3.3.1). */
export function isSilentSubmitFinding(message?: string): boolean {
  return Boolean(message && SILENT_SUBMIT.test(message));
}

/** Write (POST/PUT/PATCH/DELETE) came back 400/409/422 — UI let it through, API refused. */
export function isServerRefusedSubmitFinding(message?: string): boolean {
  return Boolean(message && SERVER_REFUSED_SUBMIT.test(message));
}

/** Blank required or junk: no field error, and the form sent that value or left the page. */
export function isAcceptedInvalidFinding(message?: string): boolean {
  return Boolean(message && ACCEPTED_INVALID.test(message));
}

/** Junk that should have been a field error crashed the page instead. */
export function isThrowInsteadOfInvalidFinding(message?: string): boolean {
  return Boolean(message && THROW_INSTEAD_OF_INVALID.test(message));
}

/** True only when this row is a single 320 reflow class, not a mixed where blob. */
export function isOverflowAt320(extras?: ChapterExtras): boolean {
  if (extras?.viewport === "320") return true;
  if (extras?.viewport === "other") return false;
  const segs = splitOverflowByViewport(extras?.where, extras?.message);
  return segs.length === 1 && segs[0]?.viewport === "320";
}

export function wcagOf(rule: string, extras?: ChapterExtras): WcagEntry {
  if (isSilentSubmitFinding(extras?.message) || isSilentSubmitFinding(rule)) {
    return A11Y.silentSubmit;
  }
  if (isServerRefusedSubmitFinding(extras?.message) || rule === "serverRefusedSubmit") {
    return { chapter: "quality" };
  }
  if (isAcceptedInvalidFinding(extras?.message) || rule === "acceptedInvalid") {
    return { chapter: "quality" };
  }
  if (isThrowInsteadOfInvalidFinding(extras?.message) || rule === "throwInsteadOfInvalid") {
    return { chapter: "quality" };
  }
  if (rule === "overflow") {
    return isOverflowAt320(extras) ? REFLOW_OVERFLOW : { chapter: "visual" };
  }
  const a11y = (A11Y as Record<string, WcagEntry>)[rule];
  if (a11y) return a11y;
  if (TESTABILITY.has(rule)) return { chapter: "testability" };
  if (VISUAL.has(rule)) return { chapter: "visual" };
  if (QUALITY.has(rule)) return { chapter: "quality" };
  const source = extras?.source;
  if (source === "a11y") return { chapter: "accessibility" };
  if (source === "visual") return { chapter: "visual" };
  if (source === "testability") return { chapter: "testability" };
  if (source === "html" || source === "seo" || source === "console" || source === "pageError") {
    return { chapter: "quality" };
  }
  return { chapter: "quality" };
}

export function chapterOf(rule: string, extras?: ChapterExtras): ReportChapter {
  return wcagOf(rule, extras).chapter;
}

export function coverageLines(failedRules: Iterable<{ rule: string; extras?: ChapterExtras }>): string[] {
  const a = new Set<string>();
  const aa = new Set<string>();
  for (const item of failedRules) {
    const entry = wcagOf(item.rule, item.extras);
    if (entry.chapter !== "accessibility" || !entry.sc || !entry.level) continue;
    if (entry.level === "A") a.add(item.rule);
    else aa.add(item.rule);
  }
  const n = (count: number) => `${count} rule${count === 1 ? "" : "s"}`;
  return [
    "Checked: WCAG 2.0/2.1 A and AA (axe subset), plus 2.1.1 (clickable non-widget), 2.1.2 (form Tab trap), 2.4.3 (form focus order), 2.2 AA 2.4.11 and 2.5.8 (DOM), 1.4.10 (320 overflow), 1.4.12 (text spacing).",
    "Not checked: 1.2.x media, 1.3.2 sequence, 2.1.4 shortcuts, 2.5.1/2.5.2 pointer, 2.5.7 dragging, 3.2.x consistent, 3.3.3–3.3.4/3.3.7–3.3.8, 4.1.3 status, AAA, pages we did not land on.",
    `Fails on covered SCs: A — ${n(a.size)}; AA — ${n(aa.size)}.`,
  ];
}

export function compareSc(a?: string, b?: string): number {
  const pa = a?.split(".").map((n) => Number(n) || 0);
  const pb = b?.split(".").map((n) => Number(n) || 0);
  if (!pa && !pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
