import { catalogLink } from "./check-catalog.js";
import type { ChapterExtras } from "./wcag.js";
import { isAxeRule, wcagOf } from "./wcag.js";

const WCAG22 = "https://www.w3.org/WAI/WCAG22/Understanding";
const HTMLVALIDATE = "https://html-validate.org/rules";
const HTML = "https://html.spec.whatwg.org/multipage";
/** axe-core 4.13.0 (this repo's @axe-core/playwright). */
const AXE = "https://dequeuniversity.com/rules/axe/4.13";

/** WCAG 2.2 Understanding slugs keyed by SC. */
const SC_SLUG: Record<string, string> = {
  "1.1.1": "non-text-content",
  "1.2.1": "audio-only-and-video-only-prerecorded",
  "1.2.2": "captions-prerecorded",
  "1.3.1": "info-and-relationships",
  "1.3.4": "orientation",
  "1.3.5": "identify-input-purpose",
  "1.4.1": "use-of-color",
  "1.4.2": "audio-control",
  "1.4.3": "contrast-minimum",
  "1.4.4": "resize-text",
  "1.4.10": "reflow",
  "1.4.12": "text-spacing",
  "2.1.1": "keyboard",
  "2.1.2": "no-keyboard-trap",
  "2.4.3": "focus-order",
  "2.2.1": "timing-adjustable",
  "2.2.2": "pause-stop-hide",
  "2.4.1": "bypass-blocks",
  "2.4.2": "page-titled",
  "2.4.7": "focus-visible",
  "2.4.11": "focus-not-obscured-minimum",
  "2.5.3": "label-in-name",
  "2.5.8": "target-size-minimum",
  "3.1.1": "language-of-page",
  "3.1.2": "language-of-parts",
  "3.3.1": "error-identification",
  "3.3.2": "labels-or-instructions",
  "4.1.2": "name-role-value",
};

export const HTMLVALIDATE_RULES = [
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
] as const;
export type HtmlValidateRule = (typeof HTMLVALIDATE_RULES)[number];
const HTMLVALIDATE_SET = new Set<string>(HTMLVALIDATE_RULES);

/** axe extras inspect enables on top of wcag2a/aa (must match surveyor EXTRA_RULES). */
export const AXE_EXTRA_RULES = [
  "tabindex",
  "heading-order",
  "skip-link",
  "empty-heading",
  "label-title-only",
  "aria-dialog-name",
  "label-content-name-mismatch",
] as const;
export type AxeExtraRule = (typeof AXE_EXTRA_RULES)[number];

export type SpecLink = { label: string; href: string };

/** Official WCAG 2.2 Understanding URL, or undefined if we have no slug for that SC. */
export function wcagUnderstandingHref(sc: string): string | undefined {
  const slug = SC_SLUG[sc];
  return slug ? `${WCAG22}/${slug}.html` : undefined;
}

export function specLink(rule: string, extras?: ChapterExtras): SpecLink | undefined {
  if (rule === "implicitSubmit") {
    return { label: "HTML button type", href: `${HTML}/form-elements.html#attr-button-type` };
  }
  if (rule === "noopener") {
    return { label: "HTML noopener", href: `${HTML}/links.html#link-type-noopener` };
  }
  if (HTMLVALIDATE_SET.has(rule)) {
    return { label: `html-validate ${rule}`, href: `${HTMLVALIDATE}/${rule}.html` };
  }
  if (isAxeRule(rule)) {
    return { label: `AXE ${rule}`, href: `${AXE}/${rule}` };
  }
  const wcag = wcagOf(rule, extras);
  if (wcag.sc) {
    const href = wcagUnderstandingHref(wcag.sc);
    if (href) {
      const title = wcag.title && wcag.title !== "Best practice" ? ` ${wcag.title}` : "";
      return { label: `WCAG ${wcag.sc}${title}`, href };
    }
  }
  const local = catalogLink(rule, extras);
  if (local) return { label: local.label, href: local.href };
  return undefined;
}

/** Markdown `[label](href)` for a why line. Empty when there is no spec. */
export function specLinkMarkdown(rule: string, extras?: ChapterExtras): string | undefined {
  const link = specLink(rule, extras);
  if (!link) return undefined;
  return `[${link.label}](${link.href})`;
}
