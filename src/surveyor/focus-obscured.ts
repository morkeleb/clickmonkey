import type { Page } from "playwright";
import type { QualityIssue } from "../schema/quality.js";

/** Visible actables probed per page (main first). */
export const MAX_ACTABLES = 24;
export const MAX_FOCUS_OBSCURED_HITS = 8;

export const ACTABLE_SEL =
  "button, a[href], input:not([type='hidden']), select, textarea, [role='button'], [role='link'], [role='tab']";

export type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type Point = { x: number; y: number };

/** One `elementFromPoint` sample after focus. */
export type ProbeHit = {
  x: number;
  y: number;
  /** Point is inside the focused control's border box and the viewport. */
  inRect: boolean;
  /** Top node is the control or a descendant (not a covering overlay). */
  self: boolean;
};

export type CoverHint = {
  tag?: string;
  role?: string;
  position?: string;
  id?: string;
  className?: string;
  name?: string;
};

export type FocusObscuredHit = {
  name: string;
  where: string;
  by: string;
};

export function rectWidth(r: Rect): number {
  return r.right - r.left;
}

export function rectHeight(r: Rect): number {
  return r.bottom - r.top;
}

export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

/**
 * 3×3 grid (corners, mid-edges, center). Inset so probes stay inside the box.
 * Degenerate boxes yield no points.
 */
export function probeGrid(r: Rect): Point[] {
  const w = rectWidth(r);
  const h = rectHeight(r);
  if (!(w > 0 && h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) return [];
  const ix = Math.min(Math.max(w * 0.1, 1), w / 2);
  const iy = Math.min(Math.max(h * 0.1, 1), h / 2);
  const xs = [r.left + ix, r.left + w / 2, r.right - ix];
  const ys = [r.top + iy, r.top + h / 2, r.bottom - iy];
  const pts: Point[] = [];
  for (const y of ys) {
    for (const x of xs) {
      if (typeof x === "number" && typeof y === "number") pts.push({ x, y });
    }
  }
  return pts;
}

/**
 * WCAG 2.4.11 AA: fail only when every probe that lands in the focused rect
 * hits a node that is not the control or a descendant. Partial cover passes.
 * No in-rect probes → not enough evidence.
 */
export function isEntirelyObscured(probes: readonly ProbeHit[]): boolean {
  if (!Array.isArray(probes) || probes.length === 0) return false;
  let landed = 0;
  for (const p of probes) {
    if (!p?.inRect) continue;
    if (p.self) return false;
    landed += 1;
  }
  return landed > 0;
}

export function skipAriaHidden(ariaHidden: string | null | undefined): boolean {
  return ariaHidden === "true";
}

export function skipDisabled(opts: {
  disabled?: boolean;
  ariaDisabled?: string | null;
}): boolean {
  return Boolean(opts.disabled) || opts.ariaDisabled === "true";
}

/** User-opened dialog/menu/popover covering the page — not sticky chrome on the focused control. */
export function skipCoveringOverlay(opts: {
  controlInsideOverlay: boolean;
  coverInsideOverlay: boolean;
}): boolean {
  return opts.coverInsideOverlay && !opts.controlInsideOverlay;
}

export function skipCoveringDialog(opts: {
  controlInsideDialog: boolean;
  coverInsideDialog: boolean;
}): boolean {
  return skipCoveringOverlay({
    controlInsideOverlay: opts.controlInsideDialog,
    coverInsideOverlay: opts.coverInsideDialog,
  });
}

/** Main first, then the rest, capped. */
export function selectActables<T extends { inMain: boolean }>(
  items: readonly T[],
  cap = MAX_ACTABLES,
): T[] {
  if (!Array.isArray(items) || cap <= 0) return [];
  const main: T[] = [];
  const rest: T[] = [];
  for (const it of items) {
    if (it.inMain) main.push(it);
    else rest.push(it);
  }
  return [...main, ...rest].slice(0, cap);
}

export function coverPhrase(hint: CoverHint): string {
  const tag = (hint.tag || "").toLowerCase();
  const role = (hint.role || "").toLowerCase();
  const pos = (hint.position || "").toLowerCase();
  const sticky = pos === "sticky" || pos === "fixed";
  const blob = `${hint.id || ""} ${hint.className || ""} ${hint.name || ""}`.toLowerCase();
  if ((tag === "header" || role === "banner") && sticky) return "the sticky header";
  if ((tag === "footer" || role === "contentinfo") && sticky) return "the sticky footer";
  if (/cookie|consent|gdpr/.test(blob)) return "the cookie banner";
  if (/chat|intercom|messenger|helpdesk|help-widget/.test(blob)) return "the chat widget";
  const name = (hint.name || "").replace(/\s+/g, " ").trim();
  if (name && name.toLowerCase() !== tag) return name;
  return "an overlay";
}

export function focusObscuredMessage(name: string, by: string): string {
  const n = name.replace(/\s+/g, " ").trim() || "Control";
  const cover = by.replace(/\s+/g, " ").trim() || "an overlay";
  return `${n} is entirely hidden by ${cover} when focused`;
}

export function focusObscuredIssue(hit: FocusObscuredHit): QualityIssue | undefined {
  if (!hit) return undefined;
  const name = String(hit.name || "").replace(/\s+/g, " ").trim();
  const where = String(hit.where || "").replace(/\s+/g, " ").trim();
  const by = String(hit.by || "").replace(/\s+/g, " ").trim();
  if (!name || !where || !by) return undefined;
  return {
    source: "visual",
    rule: "focusObscured",
    severity: "error",
    confidence: "high",
    count: 1,
    where,
    message: focusObscuredMessage(name, by),
  };
}

export function issuesFromHits(hits: FocusObscuredHit[]): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(hits)) return issues;
  for (const hit of hits) {
    const issue = focusObscuredIssue(hit);
    if (!issue) continue;
    const key = `${issue.where}\0${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
    if (issues.length >= MAX_FOCUS_OBSCURED_HITS) break;
  }
  return issues;
}

/**
 * Browser-side. Source string so tsx/esbuild `__name` helpers are not
 * serialized into the page.
 *
 * Focuses each actable and hit-tests a 3×3 grid. Does not call scrollIntoView:
 * native focus() scroll that tucks a control under sticky chrome is a hit.
 */
const COLLECT_SRC = `(() => {
  var SEL = ${JSON.stringify(ACTABLE_SEL)};
  var MAX = ${MAX_ACTABLES};
  var MAX_HITS = ${MAX_FOCUS_OBSCURED_HITS};
  var vw = window.innerWidth || 0;
  var vh = window.innerHeight || 0;
  var hits = [];

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

  function overflowPaintedRect(el) {
    var r = el.getBoundingClientRect();
    var box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    var node = el.parentElement;
    while (node && node !== document.documentElement) {
      var ocs = window.getComputedStyle(node);
      if (ocs.overflowX !== "visible" || ocs.overflowY !== "visible") {
        var pr = node.getBoundingClientRect();
        box.left = Math.max(box.left, pr.left);
        box.top = Math.max(box.top, pr.top);
        box.right = Math.min(box.right, pr.right);
        box.bottom = Math.min(box.bottom, pr.bottom);
      }
      node = node.parentElement;
    }
    if (box.right - box.left < 2 || box.bottom - box.top < 2) return null;
    return box;
  }

  function shown(el) {
    if (!el) return false;
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    }
    var cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (parseFloat(cs.opacity) === 0) return false;
    var box = overflowPaintedRect(el);
    if (!box) return false;
    if (box.right <= 0 || box.left >= vw || box.bottom <= 0) return false;
    return true;
  }

  function nativePicker(el) {
    if (!el || (el.tagName || "").toLowerCase() !== "input") return false;
    var t = (el.type || "").toLowerCase();
    return (
      t === "date" ||
      t === "datetime-local" ||
      t === "time" ||
      t === "month" ||
      t === "week" ||
      t === "color" ||
      t === "file"
    );
  }

  function isDisabled(el) {
    if (el.disabled) return true;
    if (el.getAttribute("aria-disabled") === "true") return true;
    if (typeof el.matches === "function" && el.matches(":disabled")) return true;
    return false;
  }

  function isAriaHidden(el) {
    if (!el) return false;
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return true;
    if (el.closest && el.closest("[aria-hidden='true']")) return true;
    return false;
  }

  function widgetName(el) {
    var aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return clip(aria, 40);
    var labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      var labelled = labelledBy.split(/\\s+/).map(function (id) {
        var node = document.getElementById(id);
        return node ? node.innerText : "";
      }).join(" ").trim();
      if (labelled) return clip(labelled, 40);
    }
    var text = (el.innerText || el.value || "").replace(/\\s+/g, " ").trim();
    if (text) return clip(text, 40);
    var testid = el.getAttribute("data-testid");
    if (testid && testid.trim()) return clip(testid, 40);
    if (el.id && String(el.id).trim()) return clip(el.id, 40);
    var named = el.getAttribute("name") || el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("alt");
    if (named && named.trim()) return clip(named, 40);
    return el.tagName.toLowerCase();
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
    var href = el.getAttribute("href");
    if (href && href.trim()) return tag + '[href="' + clip(href.trim(), 48) + '"]';
    return tag;
  }

  function openOverlayOf(node) {
    if (!node || !node.closest) return null;
    var d = node.closest(
      "dialog, [role='dialog'], [aria-modal='true'], [role='menu'], [role='listbox'], [role='popover']",
    );
    if (!d) return null;
    var tag = d.tagName ? d.tagName.toLowerCase() : "";
    var role = ((d.getAttribute && d.getAttribute("role")) || "").toLowerCase();
    if (tag === "dialog" && !(d.open || d.hasAttribute("open"))) return null;
    if (d.getAttribute("aria-hidden") === "true") return null;
    if (d.getAttribute("aria-expanded") === "false") return null;
    if (!shown(d) && tag !== "dialog") {
      var cs = window.getComputedStyle(d);
      if (cs.display === "none" || cs.visibility === "hidden") return null;
    }
    if ((role === "menu" || role === "listbox" || role === "popover") && !shown(d)) return null;
    return d;
  }

  function namedChromeCover(phrase) {
    return (
      phrase === "the sticky header" ||
      phrase === "the sticky footer" ||
      phrase === "the cookie banner" ||
      phrase === "the chat widget"
    );
  }

  function isSelfOrDescendant(el, top) {
    if (!top) return false;
    if (el === top || el.contains(top)) return true;
    var n = top;
    while (n) {
      if (n === el) return true;
      var root = n.getRootNode && n.getRootNode();
      n = n.parentElement || (root && root.host) || null;
    }
    return false;
  }

  function coverPhraseOf(node) {
    var cur = node;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      var tag = cur.tagName ? cur.tagName.toLowerCase() : "";
      var role = (cur.getAttribute && (cur.getAttribute("role") || "").toLowerCase()) || "";
      var cs = window.getComputedStyle(cur);
      var pos = (cs.position || "").toLowerCase();
      var sticky = pos === "sticky" || pos === "fixed";
      var blob = [
        cur.id || "",
        typeof cur.className === "string" ? cur.className : "",
        (cur.getAttribute && cur.getAttribute("aria-label")) || "",
      ].join(" ").toLowerCase();
      if ((tag === "header" || role === "banner") && sticky) return "the sticky header";
      if ((tag === "footer" || role === "contentinfo") && sticky) return "the sticky footer";
      if (/cookie|consent|gdpr/.test(blob)) return "the cookie banner";
      if (/chat|intercom|messenger|helpdesk|help-widget/.test(blob)) return "the chat widget";
      cur = cur.parentElement;
    }
    var named = widgetName(node);
    if (named && named !== (node.tagName && node.tagName.toLowerCase())) return named;
    return "an overlay";
  }

  function probePoints(r) {
    var w = r.right - r.left;
    var h = r.bottom - r.top;
    if (!(w > 0 && h > 0)) return [];
    var ix = Math.min(Math.max(w * 0.1, 1), w / 2);
    var iy = Math.min(Math.max(h * 0.1, 1), h / 2);
    var xs = [r.left + ix, r.left + w / 2, r.right - ix];
    var ys = [r.top + iy, r.top + h / 2, r.bottom - iy];
    var pts = [];
    var yi;
    var xi;
    for (yi = 0; yi < ys.length; yi++) {
      for (xi = 0; xi < xs.length; xi++) {
        pts.push({ x: xs[xi], y: ys[yi] });
      }
    }
    return pts;
  }

  function readCover(el) {
    var r = overflowPaintedRect(el);
    if (!r) return null;
    var pts = probePoints(r);
    var landed = 0;
    var selfHits = 0;
    var coverNode = null;
    var pi;
    for (pi = 0; pi < pts.length; pi++) {
      var x = pts[pi].x;
      var y = pts[pi].y;
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      if (x < 0 || y < 0 || x > vw || y > vh) continue;
      var top = document.elementFromPoint(x, y);
      if (!top) continue;
      landed += 1;
      if (isSelfOrDescendant(el, top)) {
        selfHits += 1;
        continue;
      }
      if (!coverNode) coverNode = top;
    }
    if (landed === 0 || selfHits > 0 || !coverNode) return null;
    var coverOver = openOverlayOf(coverNode);
    var controlOver = openOverlayOf(el);
    if (coverOver && coverOver !== controlOver) return null;
    var phrase = coverPhraseOf(coverNode);
    var coverActable =
      coverNode.closest &&
      coverNode.closest("button, a[href], [role='button'], [role='menuitem'], [role='option']");
    if (coverActable && !isSelfOrDescendant(el, coverActable) && !namedChromeCover(phrase)) return null;
    return {
      name: widgetName(el) || "Control",
      where: describeWhere(el),
      by: phrase,
    };
  }

  var main = document.querySelector("main, [role='main']");
  var nodes = document.querySelectorAll(SEL);
  var preferred = [];
  var rest = [];
  var n;
  for (n = 0; n < nodes.length; n++) {
    var el = nodes[n];
    if (!shown(el) || isDisabled(el) || isAriaHidden(el) || nativePicker(el)) continue;
    if (main && main.contains(el)) preferred.push(el);
    else rest.push(el);
  }
  var candidates = preferred.concat(rest);
  if (candidates.length > MAX) candidates = candidates.slice(0, MAX);
  var i;

  var overflowScrolls = [];
  function rememberOverflow(el) {
    var n = el && el.parentElement;
    while (n && n !== document.documentElement) {
      var cs = window.getComputedStyle(n);
      var ox = cs.overflowX;
      var oy = cs.overflowY;
      if (ox === "auto" || ox === "scroll" || oy === "auto" || oy === "scroll") {
        overflowScrolls.push({ el: n, top: n.scrollTop, left: n.scrollLeft });
      }
      n = n.parentElement;
    }
  }
  for (i = 0; i < candidates.length; i++) rememberOverflow(candidates[i]);

  var prev = document.activeElement;
  var scrollX = window.scrollX || 0;
  var scrollY = window.scrollY || 0;
  for (i = 0; i < candidates.length; i++) {
    var target = candidates[i];
    try {
      target.focus();
    } catch (err) {
      continue;
    }
    var active = document.activeElement;
    if (active !== target && !(target.contains && target.contains(active))) continue;
    var hit = readCover(target);
    if (hit) hits.push(hit);
    if (hits.length >= MAX_HITS) break;
  }
  try {
    if (prev && prev !== document.body && typeof prev.focus === "function") {
      prev.focus({ preventScroll: true });
    } else if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
  } catch (err2) {}
  try {
    window.scrollTo(scrollX, scrollY);
  } catch (err3) {}
  var s;
  for (s = 0; s < overflowScrolls.length; s++) {
    try {
      overflowScrolls[s].el.scrollTop = overflowScrolls[s].top;
      overflowScrolls[s].el.scrollLeft = overflowScrolls[s].left;
    } catch (err4) {}
  }
  return hits;
})()`;

export async function scanFocusObscured(page: Page): Promise<QualityIssue[]> {
  const raw = (await page.evaluate(COLLECT_SRC).catch(() => [])) as FocusObscuredHit[];
  if (!Array.isArray(raw)) return [];
  return issuesFromHits(raw);
}
