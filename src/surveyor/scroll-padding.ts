import type { Page } from "playwright";
import type { QualityIssue } from "../schema/quality.js";

/** Shorter than a tap row — does not tuck focused fields. */
export const MIN_CHROME_PX = 32;
/** Pad 0 below this is still a miss, but not a high-confidence one. */
export const HIGH_CHROME_PX = 40;

export type ScrollPaddingHit = {
  headerPx: number;
  padPx: number;
  where: string;
};

export function parseScrollPadPx(raw: string | number | null | undefined): number {
  const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export function needsScrollPadding(headerPx: number, padPx: number): boolean {
  if (!Number.isFinite(headerPx) || !Number.isFinite(padPx)) return false;
  if (headerPx < MIN_CHROME_PX) return false;
  return headerPx > padPx;
}

export function scrollPaddingConfidence(
  headerPx: number,
  padPx: number,
): "high" | "medium" {
  if (padPx <= 0 && headerPx >= HIGH_CHROME_PX) return "high";
  return "medium";
}

export function scrollPaddingMessage(headerPx: number, padPx: number): string {
  return `Sticky header is ${Math.round(headerPx)}px but scroll-padding-top is ${Math.round(padPx)}px`;
}

export function scrollPaddingIssue(
  hit: ScrollPaddingHit | null | undefined,
): QualityIssue | undefined {
  if (!hit || typeof hit !== "object") return undefined;
  const where = String(hit.where || "").replace(/\s+/g, " ").trim();
  if (!where) return undefined;
  if (typeof hit.headerPx !== "number" || typeof hit.padPx !== "number") return undefined;
  if (!needsScrollPadding(hit.headerPx, hit.padPx)) return undefined;
  return {
    source: "visual",
    rule: "scrollPadding",
    severity: "warning",
    confidence: scrollPaddingConfidence(hit.headerPx, hit.padPx),
    count: 1,
    where,
    message: scrollPaddingMessage(hit.headerPx, hit.padPx),
  };
}

/**
 * Browser-side. Source string so tsx/esbuild `__name` helpers are not
 * serialized into the page.
 */
const COLLECT_SRC = `(() => {
  var SEL = "header, [role='banner'], nav";
  var MIN = ${MIN_CHROME_PX};

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

  function cssPx(raw) {
    var s = String(raw || "").replace(/\\s+/g, " ").trim().toLowerCase();
    if (!s || s === "auto" || s === "normal") return 0;
    var n = parseFloat(s);
    return isFinite(n) && n > 0 ? n : 0;
  }

  function shown(el) {
    if (!el) return false;
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    }
    var vis = window.getComputedStyle(el);
    if (vis.display === "none" || vis.visibility === "hidden") return false;
    if (parseFloat(vis.opacity) === 0) return false;
    var box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return false;
    if (box.bottom <= 0) return false;
    return true;
  }

  function describeWhere(el) {
    var tag = el.tagName.toLowerCase();
    var hooks = ["data-testid", "data-test-id", "data-test", "data-cy"];
    var i;
    for (i = 0; i < hooks.length; i++) {
      var hook = el.getAttribute(hooks[i]);
      if (hook && hook.trim()) return tag + "[" + hooks[i] + '="' + clip(hook.trim(), 40) + '"]';
    }
    var id = el.id && String(el.id).trim();
    if (id && !generatedId(id)) return "#" + clip(id, 40);
    var named =
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      el.getAttribute("alt") ||
      el.getAttribute("name") ||
      el.getAttribute("placeholder");
    if (named && named.trim()) return tag + ' "' + clip(named.trim(), 40) + '"';
    var text = (el.innerText || "").replace(/\\s+/g, " ").trim();
    if (text) return tag + ' "' + clip(text, 40) + '"';
    return tag;
  }

  var html = document.documentElement;
  var body = document.body;
  var htmlCs = window.getComputedStyle(html);
  var bodyCs = body ? window.getComputedStyle(body) : null;
  var pad = Math.max(
    cssPx(htmlCs.scrollPaddingTop),
    bodyCs ? cssPx(bodyCs.scrollPaddingTop) : 0,
    0
  );
  var vw = window.innerWidth || 0;
  var vh = window.innerHeight || 0;

  var nodes = document.querySelectorAll(SEL);
  var best = null;
  var n;
  for (n = 0; n < nodes.length; n++) {
    var el = nodes[n];
    if (!shown(el)) continue;
    var cs = window.getComputedStyle(el);
    var pos = (cs.position || "").toLowerCase();
    if (pos !== "sticky" && pos !== "fixed") continue;
    var topPx = parseFloat(cs.top);
    if (!isFinite(topPx) || topPx > 1) continue;
    var r = el.getBoundingClientRect();
    if (r.top < -1 || r.top > 8) continue;
    if (r.height < MIN) continue;
    if (r.bottom <= 0) continue;
    if (vh && r.height >= vh * 0.4) continue;
    if (vw && r.width < vw * 0.7) continue;
    if (!best || r.height > best.headerPx) {
      best = { headerPx: r.height, padPx: pad, where: describeWhere(el) };
    }
  }
  return best;
})()`;

export async function scanScrollPadding(page: Page): Promise<QualityIssue[]> {
  const raw = (await page.evaluate(COLLECT_SRC).catch(() => null)) as ScrollPaddingHit | null;
  const issue = scrollPaddingIssue(raw);
  return issue ? [issue] : [];
}
