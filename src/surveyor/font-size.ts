import type { Page } from "playwright";
import type { QualityIssue } from "../schema/quality.js";

/** Body copy below this CSS px is a hit. */
export const FONT_SIZE_MIN_PX = 12;
/** Below this → high confidence; otherwise medium. */
export const FONT_SIZE_HIGH_PX = 10;
export const FONT_SIZE_CAP = 8;
export const WHERE_MAX = 40;

export const TEXTISH_SELECTOR = [
  "p",
  "li",
  "label",
  "td",
  "th",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "[role='heading']",
].join(", ");

export const ROOT_SELECTOR = "main, [role='main']";
export const CHROME_SELECTOR = "nav, aside, footer, [role='navigation'], [role='complementary'], [role='contentinfo']";
/** Code is often 11px on purpose. */
export const CODE_SELECTOR = "code, pre, kbd, samp";

export type FontSizeHit = {
  px: number;
  where: string;
};

export function parseFontSizePx(raw: string): number {
  const n = Number.parseFloat(String(raw || ""));
  return Number.isFinite(n) ? n : Number.NaN;
}

export function isUndersizedFont(px: number): boolean {
  return Number.isFinite(px) && px < FONT_SIZE_MIN_PX;
}

export function fontSizeConfidence(px: number): "high" | "medium" {
  return px < FONT_SIZE_HIGH_PX ? "high" : "medium";
}

export function fontSizeDisplayPx(px: number): number {
  const rounded = Math.round(px);
  return rounded >= FONT_SIZE_MIN_PX ? Math.floor(px) : rounded;
}

export function fontSizeMessage(px: number): string {
  return `Body text is ${fontSizeDisplayPx(px)}px; keep body copy at least 12px`;
}

export function fontSizeGroupKey(px: number, where: string): string {
  return `${fontSizeDisplayPx(px)}\0${where}`;
}

export function isChromeLandmark(opts: { tag?: string; role?: string }): boolean {
  const tag = (opts.tag || "").toLowerCase();
  const role = (opts.role || "").toLowerCase();
  if (tag === "nav" || tag === "aside" || tag === "footer") return true;
  return role === "navigation" || role === "complementary" || role === "contentinfo";
}

export function isCodeishTag(tag: string | undefined): boolean {
  const t = (tag || "").toLowerCase();
  return t === "code" || t === "pre" || t === "kbd" || t === "samp";
}

export function isEmptyText(text: string | undefined): boolean {
  return !String(text || "").replace(/\s+/g, " ").trim();
}

export function skipFontSizeNode(opts: {
  hidden?: boolean;
  zeroBox?: boolean;
  ariaHidden?: boolean;
  inert?: boolean;
  chrome?: boolean;
  code?: boolean;
  emptyText?: boolean;
}): boolean {
  return Boolean(
    opts.hidden ||
      opts.zeroBox ||
      opts.ariaHidden ||
      opts.inert ||
      opts.chrome ||
      opts.code ||
      opts.emptyText,
  );
}

export function fontSizeIssue(hit: FontSizeHit): QualityIssue | undefined {
  if (!hit || typeof hit.where !== "string") return undefined;
  const where = hit.where.replace(/\s+/g, " ").trim();
  if (!where) return undefined;
  if (typeof hit.px !== "number" || !isUndersizedFont(hit.px)) return undefined;
  return {
    source: "visual",
    rule: "fontSize",
    severity: "warning",
    confidence: fontSizeConfidence(hit.px),
    count: 1,
    where,
    message: fontSizeMessage(hit.px),
  };
}

export function issuesFromFontSizeHits(hits: FontSizeHit[]): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(hits)) return issues;
  for (const hit of hits) {
    const issue = fontSizeIssue(hit);
    if (!issue) continue;
    const key = fontSizeGroupKey(hit.px, issue.where ?? "");
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
    if (issues.length >= FONT_SIZE_CAP) break;
  }
  return issues;
}

/**
 * Browser-side. Source string so tsx/esbuild `__name` helpers are not
 * serialized into the page.
 */
const COLLECT_SRC = `(() => {
  var MIN = ${FONT_SIZE_MIN_PX};
  var MAX_HITS = ${FONT_SIZE_CAP};
  var WHERE_MAX = ${WHERE_MAX};
  var TEXTISH = ${JSON.stringify(TEXTISH_SELECTOR)};
  var ROOT_SEL = ${JSON.stringify(ROOT_SELECTOR)};
  var CHROME_SEL = ${JSON.stringify(CHROME_SELECTOR)};
  var CODE_SEL = ${JSON.stringify(CODE_SELECTOR)};
  var hits = [];
  var seen = {};

  function clip(s, n) {
    var one = String(s || "").replace(/\\s+/g, " ").trim();
    if (!one) return "";
    return one.length <= n ? one : one.slice(0, n - 1) + "…";
  }

  function generatedId(id) {
    if (!id) return true;
    if (id.charAt(0) === ":") return true;
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) return true;
    return false;
  }

  function shown(el) {
    if (!el) return false;
    if (el.closest && el.closest("[inert]")) return false;
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return false;
    if (el.closest && el.closest("[aria-hidden='true']")) return false;
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    }
    var cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (parseFloat(cs.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (r.bottom <= 0 || r.right <= 0) return false;
    if (r.top >= (window.innerHeight || 0) || r.left >= (window.innerWidth || 0)) return false;
    return true;
  }

  function describeWhere(el) {
    var tag = el.tagName.toLowerCase();
    var hooks = ["data-testid", "data-test-id", "data-test", "data-cy"];
    var i;
    for (i = 0; i < hooks.length; i++) {
      var hook = el.getAttribute(hooks[i]);
      if (hook && hook.trim()) return tag + "[" + hooks[i] + '="' + clip(hook.trim(), WHERE_MAX) + '"]';
    }
    var id = el.id && String(el.id).trim();
    if (id && !generatedId(id)) return "#" + clip(id, WHERE_MAX);
    var named =
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      el.getAttribute("alt") ||
      el.getAttribute("name") ||
      el.getAttribute("placeholder");
    if (named && named.trim()) return tag + ' "' + clip(named.trim(), WHERE_MAX) + '"';
    var text = (el.innerText || "").replace(/\\s+/g, " ").trim();
    if (text) return tag + ' "' + clip(text, WHERE_MAX) + '"';
    return tag;
  }

  var root = document.querySelector(ROOT_SEL) || document.body;
  if (!root) return hits;
  var nodes = root.querySelectorAll(TEXTISH);
  var n;
  for (n = 0; n < nodes.length; n++) {
    var el = nodes[n];
    if (!shown(el)) continue;
    if (el.closest && el.closest(CHROME_SEL)) continue;
    if (el.closest && el.closest(CODE_SEL)) continue;
    var text = (el.innerText || "").replace(/\\s+/g, " ").trim();
    if (!text) continue;
    var raw = window.getComputedStyle(el).fontSize;
    var px = parseFloat(raw);
    if (!isFinite(px) || px >= MIN) continue;
    var where = describeWhere(el);
    if (!where) continue;
    var rounded = Math.round(px);
    if (rounded >= MIN) rounded = Math.floor(px);
    var key = rounded + "\\0" + where;
    if (seen[key]) continue;
    seen[key] = true;
    hits.push({ px: px, where: where });
    if (hits.length >= MAX_HITS) break;
  }
  return hits;
})()`;

export async function scanFontSize(page: Page): Promise<QualityIssue[]> {
  const hits = (await page.evaluate(COLLECT_SRC).catch(() => [])) as FontSizeHit[];
  if (!Array.isArray(hits)) return [];
  return issuesFromFontSizeHits(hits);
}
