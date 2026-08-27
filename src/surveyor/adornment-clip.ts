import type { Page } from "playwright";
import type { QualityIssue } from "../schema/quality.js";
import { fieldChromeClass } from "./form-scanline.js";

export { fieldChromeClass as isFieldChromeClass };

/** Collision on both axes at or above this is clip. */
export const CLIP_PX = 4;
/** High confidence (and error) at or above this. */
export const CLIP_HIGH_PX = 12;
export const MAX_HITS = 8;
export const WHERE_MAX = 40;
/** Adornment sits on the trailing side of the host. */
export const TRAILING_RATIO = 0.4;

export const HOST_SELECTOR = [
  "input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='button']):not([type='submit']):not([type='file'])",
  "textarea",
  "[role='combobox']",
  "[role='tab']",
].join(", ");

export const UA_ICON_TYPES = ["date", "color", "range"] as const;

export type AdornmentClipKind = "tab" | "value";

export type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type AdornmentClipHit = {
  kind: AdornmentClipKind;
  where: string;
  overlapPx: number;
};

export function clipWhere(text: string, max = WHERE_MAX): string {
  const one = String(text || "").replace(/\s+/g, " ").trim();
  if (!one) return "";
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

export function adornmentOverlapPx(a: Rect, b: Rect): number {
  const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (x <= 0 || y <= 0) return 0;
  return Math.min(x, y);
}

export function isAdornmentClip(overlapPx: number, minPx = CLIP_PX): boolean {
  return Number.isFinite(overlapPx) && overlapPx >= minPx;
}

export function clipConfidence(overlapPx: number): "high" | "medium" {
  return overlapPx >= CLIP_HIGH_PX ? "high" : "medium";
}

export function clipSeverity(overlapPx: number): "error" | "warning" {
  return overlapPx >= CLIP_HIGH_PX ? "error" : "warning";
}

export function isTrailingAdornment(host: Rect, adornment: Rect, ratio = TRAILING_RATIO): boolean {
  const width = host.right - host.left;
  return adornment.left > host.left + width * ratio;
}

export function isSuffixGlyph(text: string): boolean {
  const t = String(text || "").replace(/\s+/g, "").trim();
  if (!t || t.length > 2) return false;
  if (t === "%" || t === "$" || t === "€" || t === "£" || t === "¥" || t === "₩" || t === "¢") {
    return true;
  }
  return !/[A-Za-z0-9]/.test(t);
}

export function skipUaInputType(type: string | undefined | null): boolean {
  const t = String(type || "").toLowerCase();
  return (UA_ICON_TYPES as readonly string[]).includes(t);
}

export function overflowIsScroll(overflowX: string | undefined | null): boolean {
  const ox = String(overflowX || "").toLowerCase();
  return ox === "auto" || ox === "scroll";
}

export function isCleanEllipsis(
  cs: { textOverflow?: string; webkitLineClamp?: string; lineClamp?: string },
  text?: string,
): boolean {
  if ((cs.textOverflow || "") === "ellipsis") return true;
  const clamp = cs.webkitLineClamp || cs.lineClamp;
  if (clamp && clamp !== "none") return true;
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return /[…]$/.test(t) || /\.{3}$/.test(t);
}

export function skipAdornmentHost(opts: {
  shown?: boolean;
  disabled?: boolean;
  ariaDisabled?: boolean;
  ariaHidden?: boolean;
  inMenu?: boolean;
  inListbox?: boolean;
  inChrome?: boolean;
  role?: string;
  type?: string;
  overflowX?: string;
  ellipsis?: boolean;
}): boolean {
  if (opts.shown === false) return true;
  if (opts.disabled || opts.ariaDisabled || opts.ariaHidden) return true;
  if (opts.inMenu || opts.inListbox) return true;
  const role = (opts.role || "").toLowerCase();
  if (opts.inChrome && role !== "tab") return true;
  if (skipUaInputType(opts.type)) return true;
  if (overflowIsScroll(opts.overflowX)) return true;
  if (opts.ellipsis) return true;
  return false;
}

export function adornmentClipMessage(kind: AdornmentClipKind): string {
  return kind === "tab"
    ? "Tab title collides with a trailing icon"
    : "Value collides with a trailing icon";
}

export function adornmentClipIssue(opts: {
  kind?: AdornmentClipKind;
  where: string;
  overlapPx: number;
}): QualityIssue | undefined {
  if (!opts || !isAdornmentClip(opts.overlapPx)) return undefined;
  const where = clipWhere(opts.where);
  if (!where) return undefined;
  const kind: AdornmentClipKind = opts.kind === "tab" ? "tab" : "value";
  return {
    source: "visual",
    rule: "clip",
    severity: clipSeverity(opts.overlapPx),
    confidence: clipConfidence(opts.overlapPx),
    count: 1,
    where,
    message: adornmentClipMessage(kind),
  };
}

export function issuesFromAdornmentHits(hits: AdornmentClipHit[]): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(hits)) return issues;
  for (const hit of hits) {
    if (!hit) continue;
    const issue = adornmentClipIssue(hit);
    if (!issue) continue;
    const key = `${issue.where}\0${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
    if (issues.length >= MAX_HITS) break;
  }
  return issues;
}

/**
 * Browser-side. Source string so tsx/esbuild `__name` helpers are not
 * serialized into the page.
 */
const COLLECT_SRC = `(() => {
  var CLIP_PX = ${CLIP_PX};
  var MAX_HITS = ${MAX_HITS};
  var WHERE_MAX = ${WHERE_MAX};
  var TRAILING_RATIO = ${TRAILING_RATIO};
  var HOST_SEL = ${JSON.stringify(HOST_SELECTOR)};
  var SKIP_TYPES = ${JSON.stringify([...UA_ICON_TYPES])};
  var hits = [];
  var seen = {};
  var measureCanvas = null;

  function clip(s, n) {
    var one = String(s || "").replace(/\\s+/g, " ").trim();
    if (!one) return "";
    return one.length <= n ? one : one.slice(0, n - 1) + "…";
  }

  function shown(el) {
    if (!el) return false;
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return false;
    if (el.closest && el.closest("[aria-hidden='true']")) return false;
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    }
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    if (r.bottom <= 0 || r.right <= 0) return false;
    if (r.top >= (window.innerHeight || 0) || r.left >= (window.innerWidth || 0)) return false;
    return true;
  }

  function paintShown(el) {
    if (!el) return false;
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    }
    var cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (parseFloat(cs.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    return r.width >= 4 && r.height >= 4;
  }

  function overlapPx(a, b) {
    var x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    var y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (x <= 0 || y <= 0) return 0;
    return Math.min(x, y);
  }

  function boxOf(r) {
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }

  function isDisabled(el) {
    if (el.disabled) return true;
    if (el.getAttribute("aria-disabled") === "true") return true;
    if (typeof el.matches === "function" && el.matches(":disabled")) return true;
    return false;
  }

  function inChrome(el) {
    return Boolean(
      el.closest &&
        el.closest("header, nav, aside, footer, [role='banner'], [role='navigation'], [role='contentinfo']"),
    );
  }

  function skipType(type) {
    var t = String(type || "").toLowerCase();
    var i;
    for (i = 0; i < SKIP_TYPES.length; i++) {
      if (SKIP_TYPES[i] === t) return true;
    }
    return false;
  }

  function isSuffixGlyph(text) {
    var t = String(text || "").replace(/\\s+/g, "").trim();
    if (!t || t.length > 2) return false;
    if (t === "%" || t === "$" || t === "€" || t === "£" || t === "¥" || t === "₩" || t === "¢") return true;
    return !/[A-Za-z0-9]/.test(t);
  }

  function isChromeClass(className) {
    var parts = String(className || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[\\s._-]+/);
    var i;
    for (i = 0; i < parts.length - 1; i++) {
      if (!parts[i] || !parts[i + 1]) continue;
      if (parts[i] === "outlined" && parts[i + 1] === "input") return true;
      if (parts[i] === "text" && parts[i + 1] === "field") return true;
      if (parts[i] === "input" && parts[i + 1] === "root") return true;
    }
    return false;
  }

  function cleanEllipsis(cs, text) {
    if (cs.textOverflow === "ellipsis") return true;
    var clamp = cs.webkitLineClamp || cs.lineClamp;
    if (clamp && clamp !== "none") return true;
    var t = String(text || "").replace(/\\s+/g, " ").trim();
    return /[…]$/.test(t) || /\\.{3}$/.test(t);
  }

  function overflowScrolls(el) {
    var cs = window.getComputedStyle(el);
    return cs.overflowX === "auto" || cs.overflowX === "scroll";
  }

  function fieldChrome(el) {
    var role = (el.getAttribute("role") || "").toLowerCase();
    if (role === "tab") return el;
    var combo = el.closest && el.closest("[role='combobox']");
    if (combo && shown(combo)) return combo;
    var cur = el;
    var steps = 0;
    while (cur && steps < 5) {
      var r = (cur.getAttribute("role") || "").toLowerCase();
      if (r === "combobox" && shown(cur)) return cur;
      if (isChromeClass(cur.getAttribute("class")) && shown(cur)) return cur;
      cur = cur.parentElement;
      steps += 1;
      if (!cur || cur === document.body) break;
      var tag = (cur.tagName || "").toLowerCase();
      if (tag === "form" || tag === "td" || tag === "tr" || tag === "table") break;
      var pr = (cur.getAttribute("role") || "").toLowerCase();
      if (pr === "dialog" || pr === "tablist" || pr === "menu" || pr === "listbox") break;
    }
    var p = el.parentElement;
    if (p && shown(p)) {
      var pr2 = (p.getAttribute("role") || "").toLowerCase();
      if (pr2 === "tablist" || pr2 === "menu" || pr2 === "listbox") return el;
      var pb = p.getBoundingClientRect();
      var eb = el.getBoundingClientRect();
      if (pb.height <= eb.height + 36 && pb.width <= eb.width + 48 && pb.height >= eb.height - 2) {
        return p;
      }
    }
    return el;
  }

  function isIconish(el) {
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "svg" || tag === "img") return true;
    var cls = String(el.getAttribute("class") || "").toLowerCase();
    if (cls.indexOf("icon") >= 0) return true;
    if (tag === "span" || tag === "i" || tag === "b" || tag === "em") {
      if (el.children && el.children.length > 0) return false;
      return isSuffixGlyph(el.textContent || "");
    }
    return false;
  }

  function firstTextNode(el) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walker.nextNode())) {
      if (n.parentElement && n.parentElement.closest && n.parentElement.closest("svg, img")) continue;
      if (n.nodeValue && String(n.nodeValue).replace(/\\s+/g, "").length) return n;
    }
    return null;
  }

  function measureTextWidth(cs, text) {
    try {
      if (!measureCanvas) measureCanvas = document.createElement("canvas");
      var ctx = measureCanvas.getContext("2d");
      if (!ctx) return null;
      ctx.font = cs.font;
      return ctx.measureText(text).width;
    } catch (e) {
      return null;
    }
  }

  function inputTextRect(el) {
    var value = String(el.value || "");
    if (!value) return null;
    var nl = value.indexOf("\\n");
    if (nl >= 0) value = value.slice(0, nl);
    value = value.replace(/\\s+$/g, "");
    if (!value) return null;
    var box = el.getBoundingClientRect();
    var cs = window.getComputedStyle(el);
    var bl = parseFloat(cs.borderLeftWidth) || 0;
    var br = parseFloat(cs.borderRightWidth) || 0;
    var bt = parseFloat(cs.borderTopWidth) || 0;
    var bb = parseFloat(cs.borderBottomWidth) || 0;
    var pl = parseFloat(cs.paddingLeft) || 0;
    var pr = parseFloat(cs.paddingRight) || 0;
    var pt = parseFloat(cs.paddingTop) || 0;
    var pb = parseFloat(cs.paddingBottom) || 0;
    var contentLeft = box.left + bl + pl;
    var contentRight = box.right - br - pr;
    var contentTop = box.top + bt + pt;
    var contentBottom = box.bottom - bb - pb;
    var textW = measureTextWidth(cs, value);
    if (textW == null || !isFinite(textW) || textW <= 0) {
      return { left: contentLeft, top: contentTop, right: contentRight, bottom: contentBottom };
    }
    var scroll = el.scrollLeft || 0;
    var left = contentLeft - scroll;
    var right = Math.min(left + textW, contentRight);
    left = Math.max(left, contentLeft);
    if (right - left < 2) return null;
    var lh = parseFloat(cs.lineHeight);
    if (!isFinite(lh) || lh <= 0) lh = parseFloat(cs.fontSize) || (contentBottom - contentTop);
    var bottom = Math.min(contentTop + lh, contentBottom);
    return { left: left, top: contentTop, right: right, bottom: bottom };
  }

  function textRect(el) {
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return inputTextRect(el);
    var inner = el.querySelector && el.querySelector("input, textarea");
    if (inner && String(inner.value || "").trim()) return inputTextRect(inner);
    var tn = firstTextNode(el);
    if (!tn) return null;
    try {
      var range = document.createRange();
      range.selectNodeContents(tn);
      var rects = range.getClientRects();
      if (!rects.length) return null;
      var r = rects[0];
      if (r.width < 2 || r.height < 2) return null;
      return boxOf(r);
    } catch (e) {
      return null;
    }
  }

  function hostKind(el) {
    var role = (el.getAttribute("role") || "").toLowerCase();
    if (role === "tab") return "tab";
    return "value";
  }

  function hostLabel(el, kind) {
    if (kind === "tab") {
      var aria = el.getAttribute("aria-label");
      if (aria && aria.trim()) return clip(aria, WHERE_MAX);
      var tn = firstTextNode(el);
      if (tn) return clip(tn.nodeValue || "", WHERE_MAX);
      return clip(el.innerText || "", WHERE_MAX);
    }
    var val = el.value;
    if ((val == null || !String(val).trim()) && el.querySelector) {
      var inner = el.querySelector("input, textarea");
      if (inner) val = inner.value;
    }
    if (val && String(val).trim()) return clip(val, WHERE_MAX);
    var labelled = el.getAttribute("aria-label");
    if (labelled && labelled.trim()) return clip(labelled, WHERE_MAX);
    var named =
      el.getAttribute("name") ||
      el.getAttribute("data-testid") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("title");
    if (named && String(named).trim()) return clip(named, WHERE_MAX);
    return clip(el.innerText || "", WHERE_MAX) || "field";
  }

  function findOverlap(host, chrome, ink) {
    var root = chrome || host;
    var nodes = root.querySelectorAll("svg, img, [class*='icon'], span, i");
    var hr = host.getBoundingClientRect();
    var best = 0;
    var i;
    for (i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el === host) continue;
      if (!isIconish(el)) continue;
      if (!paintShown(el)) continue;
      var r = el.getBoundingClientRect();
      if (r.width > hr.width * 0.5) continue;
      if (r.left <= hr.left + hr.width * TRAILING_RATIO) continue;
      var amt = overlapPx(ink, boxOf(r));
      if (amt > best) best = amt;
    }
    return best;
  }

  var nodes = document.querySelectorAll(HOST_SEL);
  var n;
  for (n = 0; n < nodes.length; n++) {
    if (hits.length >= MAX_HITS) break;
    var el = nodes[n];
    var tag = (el.tagName || "").toLowerCase();
    var role = (el.getAttribute("role") || "").toLowerCase();
    var type = tag === "input" ? (el.type || "text").toLowerCase() : "";
    if (role === "combobox") {
      var innerHost = el.querySelector(
        "input:not([type='hidden']):not([type='checkbox']):not([type='radio']), textarea",
      );
      if (innerHost && shown(innerHost) && !skipType(innerHost.type)) continue;
    }
    if (!shown(el) || isDisabled(el)) continue;
    if (el.closest && el.closest("[role='menu'], [role='listbox']")) continue;
    if (inChrome(el) && role !== "tab") continue;
    if (skipType(type)) continue;
    if (overflowScrolls(el)) continue;
    var chrome = fieldChrome(el);
    if (chrome !== el && overflowScrolls(chrome)) continue;
    var ink = textRect(el);
    if (!ink) continue;
    var label = hostLabel(el, hostKind(el));
    var cs = window.getComputedStyle(el);
    if (cleanEllipsis(cs, label)) continue;
    if (chrome !== el && cleanEllipsis(window.getComputedStyle(chrome), label)) continue;
    var amt = findOverlap(el, chrome, ink);
    if (amt < CLIP_PX) {
      var contentBox = null;
      if (tag === "input" || tag === "textarea") {
        var box = el.getBoundingClientRect();
        var ics = window.getComputedStyle(el);
        contentBox = {
          left: box.left + (parseFloat(ics.borderLeftWidth) || 0) + (parseFloat(ics.paddingLeft) || 0),
          top: box.top + (parseFloat(ics.borderTopWidth) || 0) + (parseFloat(ics.paddingTop) || 0),
          right: box.right - (parseFloat(ics.borderRightWidth) || 0) - (parseFloat(ics.paddingRight) || 0),
          bottom: box.bottom - (parseFloat(ics.borderBottomWidth) || 0) - (parseFloat(ics.paddingBottom) || 0),
        };
        amt = Math.max(amt, findOverlap(el, chrome, contentBox));
      }
    }
    if (amt < CLIP_PX) continue;
    var kind = hostKind(el);
    var where = label || kind;
    var key = kind + "\\0" + where;
    if (seen[key]) continue;
    seen[key] = true;
    hits.push({ kind: kind, where: where, overlapPx: amt });
  }
  return hits;
})()`;

export async function scanAdornmentClip(page: Page): Promise<QualityIssue[]> {
  const raw = (await page.evaluate(COLLECT_SRC).catch(() => [])) as AdornmentClipHit[];
  if (!Array.isArray(raw)) return [];
  return issuesFromAdornmentHits(raw);
}
