import type { Page } from "playwright";
import type { QualityIssue } from "../schema/quality.js";

export const CLIP_PX = 4;
export const CLIP_HIGH_PX = 12;
export const MAX_HITS = 8;
export const WHERE_MAX = 40;
/** Small dialog/panel vs viewport — chrome behind these is skipped. */
export const SMALL_DIALOG_VW = 0.7;

/** scanline.ts already files clip on these. */
export const SCANLINE_OWNED = "td, th, [role='cell'], [role='gridcell'], input, textarea";

export const CANDIDATE_SELECTOR = [
  "[role='tab']",
  "button",
  "[role='button']",
  "a",
  "[role='link']",
  "h1, h2, h3, h4, h5, h6",
  "[role='heading']",
  "[role='menuitem']",
  "[role='toolbar'] label",
  "[class~='chip'][role]",
  "[class~='badge'][role]",
].join(", ");

export type TextClipKind =
  | "tab"
  | "button"
  | "link"
  | "heading"
  | "chip"
  | "badge"
  | "menuitem"
  | "toolbar"
  | "text";

export type TextClipHit = {
  rule: "clip";
  where: string;
  message: string;
  confidence: "high" | "medium";
};

const KIND_MESSAGES: Record<TextClipKind, string> = {
  tab: "Tab title is cut mid-word without an ellipsis",
  button: "Button label is cut mid-word without an ellipsis",
  link: "Link text is cut mid-word without an ellipsis",
  heading: "Heading is cut mid-word without an ellipsis",
  chip: "Chip label is cut mid-word without an ellipsis",
  badge: "Badge is cut mid-word without an ellipsis",
  menuitem: "Menu item is cut mid-word without an ellipsis",
  toolbar: "Toolbar label is cut mid-word without an ellipsis",
  text: "Text is cut mid-word without an ellipsis",
};

export function clipWhere(text: string, max = WHERE_MAX): string {
  const one = String(text || "").replace(/\s+/g, " ").trim();
  if (!one) return "";
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

export function clipConfidence(overflowPx: number): "high" | "medium" {
  return overflowPx >= CLIP_HIGH_PX ? "high" : "medium";
}

export function textClipMessage(kind: TextClipKind): string {
  return KIND_MESSAGES[kind] ?? KIND_MESSAGES.text;
}

export function isWidthClipped(scrollWidth: number, clientWidth: number, clipPx = CLIP_PX): boolean {
  return scrollWidth > clientWidth + clipPx;
}

export function overflowIsScroll(overflowX: string): boolean {
  return overflowX === "auto" || overflowX === "scroll";
}

export function overflowClipsX(overflowX: string): boolean {
  return overflowX === "hidden" || overflowX === "clip";
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

export function scanlineOwnsNode(opts: { tag?: string; role?: string }): boolean {
  const tag = (opts.tag || "").toLowerCase();
  const role = (opts.role || "").toLowerCase();
  if (tag === "td" || tag === "th" || tag === "input" || tag === "textarea") return true;
  return role === "cell" || role === "gridcell";
}

/** Skip clips in page chrome when a small dialog/panel is open in front. */
export function skipChromeBehindDialog(opts: {
  viewportWidth: number;
  dialogWidth?: number;
  insideDialog: boolean;
}): boolean {
  if (opts.insideDialog) return false;
  if (opts.dialogWidth == null) return false;
  return opts.dialogWidth < opts.viewportWidth * SMALL_DIALOG_VW;
}

export function skipOpenMenu(opts: { inMenu: boolean; menuShown: boolean }): boolean {
  return opts.inMenu && opts.menuShown;
}

export function kindFromRoleTag(opts: {
  role?: string;
  tag?: string;
  className?: string;
  inToolbar?: boolean;
}): TextClipKind {
  const role = (opts.role || "").toLowerCase();
  const tag = (opts.tag || "").toLowerCase();
  const cls = ` ${opts.className || ""} `.toLowerCase();
  if (role === "tab") return "tab";
  if (role === "menuitem") return "menuitem";
  if (tag === "button" || role === "button") return "button";
  if (tag === "a" || role === "link") return "link";
  if (/^h[1-6]$/.test(tag) || role === "heading") return "heading";
  if (/\schip\s/.test(cls)) return "chip";
  if (/\sbadge\s/.test(cls)) return "badge";
  if (opts.inToolbar) return "toolbar";
  return "text";
}

export function textClipIssue(opts: {
  kind: TextClipKind;
  where: string;
  overflowPx: number;
}): QualityIssue {
  const where = clipWhere(opts.where) || opts.kind;
  return {
    source: "visual",
    rule: "clip",
    severity: "error",
    message: textClipMessage(opts.kind),
    count: 1,
    confidence: clipConfidence(opts.overflowPx),
    where,
  };
}

/**
 * Browser-side. Source string so tsx/esbuild `__name` helpers are not
 * serialized into the page.
 */
const COLLECT_SRC = `(() => {
  var CLIP_PX = ${CLIP_PX};
  var CLIP_HIGH_PX = ${CLIP_HIGH_PX};
  var MAX_HITS = ${MAX_HITS};
  var WHERE_MAX = ${WHERE_MAX};
  var SMALL_DIALOG_VW = ${SMALL_DIALOG_VW};
  var SCANLINE_OWNED = ${JSON.stringify(SCANLINE_OWNED)};
  var CANDIDATE_SELECTOR = ${JSON.stringify(CANDIDATE_SELECTOR)};
  var MESSAGES = ${JSON.stringify(KIND_MESSAGES)};
  var hits = [];
  var seen = {};
  var hitEls = [];

  function shown(el) {
    if (!el) return false;
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return false;
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    }
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    if (r.bottom <= 0 || r.right <= 0) return false;
    if (r.top >= (window.innerHeight || 0) || r.left >= (window.innerWidth || 0)) return false;
    return true;
  }

  function clipText(s, n) {
    var one = String(s || "").replace(/\\s+/g, " ").trim();
    if (!one) return "";
    return one.length <= n ? one : one.slice(0, n - 1) + "…";
  }

  function overflowIsScroll(ox) {
    return ox === "auto" || ox === "scroll";
  }

  function overflowClipsX(ox) {
    return ox === "hidden" || ox === "clip";
  }

  function cleanEllipsis(cs, text) {
    if (cs.textOverflow === "ellipsis") return true;
    var clamp = cs.webkitLineClamp || cs.lineClamp;
    if (clamp && clamp !== "none") return true;
    var t = String(text || "").replace(/\\s+/g, " ").trim();
    return /[…]$/.test(t) || /\\.{3}$/.test(t);
  }

  function accName(el) {
    var labelled = el.getAttribute("aria-label");
    if (labelled && labelled.trim()) return labelled;
    var ids = el.getAttribute("aria-labelledby");
    if (ids) {
      var parts = [];
      var bits = ids.split(/\\s+/);
      var i;
      for (i = 0; i < bits.length; i++) {
        if (!bits[i]) continue;
        var n = document.getElementById(bits[i]);
        if (n && n.innerText) parts.push(n.innerText);
      }
      var joined = parts.join(" ").trim();
      if (joined) return joined;
    }
    var title = el.getAttribute("title");
    if (title && title.trim()) return title;
    return el.innerText || "";
  }

  function kindOf(el) {
    var role = (el.getAttribute("role") || "").toLowerCase();
    var tag = el.tagName.toLowerCase();
    var cls = " " + (el.getAttribute("class") || "") + " ";
    var clsLow = cls.toLowerCase();
    if (role === "tab") return "tab";
    if (role === "menuitem") return "menuitem";
    if (tag === "button" || role === "button") return "button";
    if (tag === "a" || role === "link") return "link";
    if (/^h[1-6]$/.test(tag) || role === "heading") return "heading";
    if (clsLow.indexOf(" chip ") >= 0) return "chip";
    if (clsLow.indexOf(" badge ") >= 0) return "badge";
    if (el.closest && el.closest("[role='toolbar']")) return "toolbar";
    return "text";
  }

  function inOpenMenu(el) {
    var menu = el.closest ? el.closest("[role='menu']") : null;
    if (!menu) return false;
    if (menu.getAttribute("aria-hidden") === "true") return false;
    return shown(menu);
  }

  function smallOpenDialog() {
    var nodes = document.querySelectorAll("dialog[open], [role='dialog']");
    var vw = window.innerWidth || 0;
    var i;
    for (i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.getAttribute("aria-hidden") === "true") continue;
      if (!shown(el)) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 80) continue;
      if (r.width < vw * SMALL_DIALOG_VW) return el;
    }
    return null;
  }

  function coveredByHit(el) {
    var i;
    for (i = 0; i < hitEls.length; i++) {
      if (hitEls[i].contains(el)) return true;
    }
    return false;
  }

  function hasMaxWidth(cs) {
    var mw = cs.maxWidth;
    return Boolean(mw && mw !== "none" && parseFloat(mw) > 0);
  }

  function inkOverflowsBox(el, boxEl) {
    try {
      var range = document.createRange();
      range.selectNodeContents(el);
      var rects = range.getClientRects();
      if (!rects.length) return false;
      var br = boxEl.getBoundingClientRect();
      var cs = window.getComputedStyle(boxEl);
      var right = br.right - (parseFloat(cs.paddingRight) || 0) - (parseFloat(cs.borderRightWidth) || 0);
      var i;
      for (i = 0; i < rects.length; i++) {
        if (rects[i].width < 2) continue;
        if (rects[i].right > right + CLIP_PX) return true;
      }
    } catch (e) {}
    return false;
  }

  function overflowAmt(el) {
    return el.scrollWidth - el.clientWidth;
  }

  function isClipped(el) {
    var text = (el.innerText || "").replace(/\\s+/g, " ").trim();
    if (text.length < 2) return false;
    var cs = window.getComputedStyle(el);
    if (cleanEllipsis(cs, text)) return false;
    if (overflowIsScroll(cs.overflowX)) return false;
    if (overflowClipsX(cs.overflowX) && el.scrollWidth > el.clientWidth + CLIP_PX) return true;
    var node = el.parentElement;
    var depth = 0;
    while (node && depth < 4 && node !== document.documentElement) {
      var ncs = window.getComputedStyle(node);
      if (overflowIsScroll(ncs.overflowX)) return false;
      if (overflowClipsX(ncs.overflowX) && hasMaxWidth(ncs)) {
        if (cleanEllipsis(ncs, "")) return false;
        if (inkOverflowsBox(el, node)) return true;
      }
      node = node.parentElement;
      depth++;
    }
    return false;
  }

  function push(el, kind, where, amt) {
    var message = MESSAGES[kind] || MESSAGES.text;
    var key = kind + "\\0" + where + "\\0" + message;
    if (seen[key]) return;
    seen[key] = true;
    hitEls.push(el);
    hits.push({
      rule: "clip",
      where: where,
      message: message,
      confidence: amt >= CLIP_HIGH_PX ? "high" : "medium",
    });
  }

  var dlg = smallOpenDialog();
  var nodes = document.querySelectorAll(CANDIDATE_SELECTOR);
  var i;
  for (i = 0; i < nodes.length; i++) {
    if (hits.length >= MAX_HITS) break;
    var el = nodes[i];
    if (!shown(el)) continue;
    if (el.matches(SCANLINE_OWNED)) continue;
    if (el.closest && el.closest(SCANLINE_OWNED)) continue;
    if (inOpenMenu(el)) continue;
    if (dlg && !dlg.contains(el)) continue;
    if (coveredByHit(el)) continue;
    if (!isClipped(el)) continue;
    var amt = overflowAmt(el);
    if (amt <= CLIP_PX) {
      var box = el;
      var d = 0;
      while (box && d < 4) {
        var bcs = window.getComputedStyle(box);
        if (overflowClipsX(bcs.overflowX) && hasMaxWidth(bcs)) {
          amt = Math.max(amt, box.scrollWidth - box.clientWidth);
          break;
        }
        box = box.parentElement;
        d++;
      }
    }
    if (amt <= CLIP_PX) amt = CLIP_PX + 1;
    var kind = kindOf(el);
    var where = clipText(accName(el), WHERE_MAX) || kind;
    push(el, kind, where, amt);
  }

  return hits;
})()`;

export async function scanTextClip(page: Page): Promise<QualityIssue[]> {
  const hits = (await page.evaluate(COLLECT_SRC).catch(() => [])) as TextClipHit[];
  const issues: QualityIssue[] = [];
  if (!Array.isArray(hits)) return issues;
  for (const hit of hits) {
    if (hit.rule !== "clip") continue;
    if (!hit.message || !hit.where) continue;
    issues.push({
      source: "visual",
      rule: "clip",
      severity: "error",
      message: hit.message,
      count: 1,
      confidence: hit.confidence === "high" ? "high" : "medium",
      where: hit.where,
    });
    if (issues.length >= MAX_HITS) break;
  }
  return issues;
}
