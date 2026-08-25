import type { Page } from "playwright";
import type { QualityIssue } from "../schema/quality.js";
import { ACTABLE_SEL, MAX_ACTABLES } from "./focus-obscured.js";

/** WCAG 2.4.7 — missing focus ring, not 2.4.11 (entirely hidden). */
export const MAX_FOCUS_VISIBLE_HITS = 8;

export type FocusStyle = {
  outlineStyle: string;
  outlineWidth: string;
  outlineColor: string;
  outlineOffset: string;
  boxShadow: string;
  borderTopWidth: string;
  borderTopColor: string;
  borderBottomWidth: string;
  borderBottomColor: string;
  backgroundColor: string;
  color: string;
  textDecorationLine?: string;
  textDecoration?: string;
};

export type FocusVisibleHit = {
  name: string;
  where: string;
  before?: FocusStyle;
  after?: FocusStyle;
  /** Wrapping field chrome (`:focus-within` ring), not the input itself. */
  beforeParents?: FocusStyle[];
  afterParents?: FocusStyle[];
  /** Sibling notched outline / ::before / ::after (MUI OutlinedInput). */
  beforeChrome?: FocusStyle[];
  afterChrome?: FocusStyle[];
};

function noneish(v: string | undefined): boolean {
  const s = String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return !s || s === "none";
}

function decorationLine(style: FocusStyle): string {
  const line = String(style.textDecorationLine ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (line) return line === "none" ? "none" : line;
  const raw = String(style.textDecoration ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!raw || raw === "none" || raw.startsWith("none ")) return "none";
  return raw;
}

function hasVisibleOutline(style: FocusStyle): boolean {
  const kind = String(style.outlineStyle ?? "")
    .trim()
    .toLowerCase();
  if (!kind || kind === "none") return false;
  const w = Number.parseFloat(String(style.outlineWidth ?? ""));
  return Number.isFinite(w) && w > 0;
}

function outlineKey(style: FocusStyle): string {
  return `${style.outlineStyle ?? ""}|${style.outlineWidth ?? ""}|${style.outlineColor ?? ""}|${style.outlineOffset ?? ""}`;
}

/** True when the focused snapshot has a ring, glow, or author stand-in. */
export function focusIndicatorChanged(before: FocusStyle, after: FocusStyle): boolean {
  if (!before || !after) return false;
  // A ring that was already there (UA outline on a sibling) is not a new indicator.
  if (hasVisibleOutline(after) && outlineKey(before) !== outlineKey(after)) return true;

  const afterShadow = String(after.boxShadow ?? "").replace(/\s+/g, " ").trim();
  const beforeShadow = String(before.boxShadow ?? "").replace(/\s+/g, " ").trim();
  if (!noneish(afterShadow) && afterShadow !== beforeShadow) return true;

  if (String(after.borderTopWidth ?? "") !== String(before.borderTopWidth ?? "")) return true;
  if (String(after.borderTopColor ?? "") !== String(before.borderTopColor ?? "")) return true;
  if (String(after.borderBottomWidth ?? "") !== String(before.borderBottomWidth ?? "")) return true;
  if (String(after.borderBottomColor ?? "") !== String(before.borderBottomColor ?? "")) return true;

  if (String(after.backgroundColor ?? "") !== String(before.backgroundColor ?? "")) return true;
  if (String(after.color ?? "") !== String(before.color ?? "")) return true;

  if (decorationLine(before) === "none" && decorationLine(after) !== "none") return true;
  return false;
}

function parentIndicatorChanged(before: FocusStyle[] | undefined, after: FocusStyle[] | undefined): boolean {
  if (!before?.length || !after?.length) return false;
  const n = Math.min(before.length, after.length);
  for (let i = 0; i < n; i++) {
    const b = before[i];
    const a = after[i];
    if (b && a && focusIndicatorChanged(b, a)) return true;
  }
  return false;
}

export function focusVisibleIssue(hit: FocusVisibleHit): QualityIssue | undefined {
  if (!hit) return undefined;
  const name = String(hit.name || "").replace(/\s+/g, " ").trim();
  const where = String(hit.where || "").replace(/\s+/g, " ").trim();
  if (!name || !where) return undefined;
  if (hit.before && hit.after && focusIndicatorChanged(hit.before, hit.after)) return undefined;
  if (parentIndicatorChanged(hit.beforeParents, hit.afterParents)) return undefined;
  if (parentIndicatorChanged(hit.beforeChrome, hit.afterChrome)) return undefined;
  return {
    source: "visual",
    rule: "focusVisible",
    severity: "warning",
    confidence: "high",
    count: 1,
    where,
    message: `${name} has no visible focus indicator (WCAG 2.4.7)`,
  };
}

export function issuesFromHits(hits: FocusVisibleHit[]): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(hits)) return issues;
  for (const hit of hits) {
    const issue = focusVisibleIssue(hit);
    if (!issue) continue;
    const key = `${issue.where}\0${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
    if (issues.length >= MAX_FOCUS_VISIBLE_HITS) break;
  }
  return issues;
}

/**
 * Browser-side. Source string so tsx/esbuild `__name` helpers are not
 * serialized into the page.
 *
 * Snapshots computed style, focuses (keyboard-visible, no scrollIntoView),
 * snapshots again. Node decides whether the delta is a ring.
 */
const COLLECT_SRC = `(() => {
  var SEL = ${JSON.stringify(ACTABLE_SEL)};
  var MAX = ${MAX_ACTABLES};
  var vw = window.innerWidth || 0;
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

  function shown(el) {
    if (!el) return false;
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    }
    var cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (parseFloat(cs.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (r.right <= 0 || r.left >= vw || r.bottom <= 0) return false;
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

  function unreliableUaRing(el) {
    if (!el || (el.tagName || "").toLowerCase() !== "input") return false;
    var t = (el.type || "").toLowerCase();
    return t === "checkbox" || t === "radio" || t === "range";
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

  function snapCs(cs) {
    if (!cs) return null;
    return {
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      outlineColor: cs.outlineColor,
      outlineOffset: cs.outlineOffset,
      boxShadow: cs.boxShadow,
      borderTopWidth: cs.borderTopWidth,
      borderTopColor: cs.borderTopColor,
      borderBottomWidth: cs.borderBottomWidth,
      borderBottomColor: cs.borderBottomColor,
      backgroundColor: cs.backgroundColor,
      color: cs.color,
      textDecorationLine: cs.textDecorationLine,
      textDecoration: cs.textDecoration
    };
  }

  function snap(el) {
    if (!el) return null;
    return snapCs(window.getComputedStyle(el));
  }

  function snapParents(el) {
    var out = [];
    var p = el && el.parentElement;
    var n = 0;
    while (p && n < 4 && p !== document.body && p !== document.documentElement) {
      var s = snap(p);
      if (s) out.push(s);
      p = p.parentElement;
      n += 1;
    }
    return out;
  }

  function snapPseudos(el) {
    var out = [];
    if (!el) return out;
    out.push(snapCs(window.getComputedStyle(el, "::before")));
    out.push(snapCs(window.getComputedStyle(el, "::after")));
    return out;
  }

  function snapSiblings(el) {
    var out = [];
    var p = el && el.parentElement;
    if (!p) return out;
    var kids = p.children;
    var i;
    for (i = 0; i < kids.length && out.length < 6; i++) {
      var node = kids[i];
      if (node === el) continue;
      var tag = (node.tagName || "").toLowerCase();
      if (tag === "script" || tag === "style" || tag === "noscript") continue;
      var s = snap(node);
      if (s) out.push(s);
    }
    return out;
  }

  function snapChrome(el) {
    var out = [];
    out = out.concat(snapSiblings(el));
    out = out.concat(snapPseudos(el));
    var p = el && el.parentElement;
    var n = 0;
    while (p && n < 4 && p !== document.body && p !== document.documentElement) {
      out = out.concat(snapPseudos(p));
      p = p.parentElement;
      n += 1;
    }
    return out.filter(Boolean);
  }

  var main = document.querySelector("main, [role='main']");
  var nodes = document.querySelectorAll(SEL);
  var preferred = [];
  var rest = [];
  var n;
  for (n = 0; n < nodes.length; n++) {
    var el = nodes[n];
    if (!shown(el) || isDisabled(el) || isAriaHidden(el) || nativePicker(el) || unreliableUaRing(el)) continue;
    if (main && main.contains(el)) preferred.push(el);
    else rest.push(el);
  }
  var candidates = preferred.concat(rest);
  if (candidates.length > MAX) candidates = candidates.slice(0, MAX);
  var i;

  var overflowScrolls = [];
  function rememberOverflow(node) {
    var p = node && node.parentElement;
    while (p && p !== document.documentElement) {
      var ocs = window.getComputedStyle(p);
      var ox = ocs.overflowX;
      var oy = ocs.overflowY;
      if (ox === "auto" || ox === "scroll" || oy === "auto" || oy === "scroll") {
        overflowScrolls.push({ el: p, top: p.scrollTop, left: p.scrollLeft });
      }
      p = p.parentElement;
    }
  }
  for (i = 0; i < candidates.length; i++) rememberOverflow(candidates[i]);

  // MUI / WICG focus-visible only add the ring after a Tab keydown, not focus().
  try {
    var tab = { key: "Tab", code: "Tab", keyCode: 9, which: 9, bubbles: true, cancelable: true };
    document.dispatchEvent(new KeyboardEvent("keydown", tab));
    window.dispatchEvent(new KeyboardEvent("keydown", tab));
  } catch (errTab) {}

  var prev = document.activeElement;
  var scrollX = window.scrollX || 0;
  var scrollY = window.scrollY || 0;
  for (i = 0; i < candidates.length; i++) {
    var target = candidates[i];
    try {
      if (document.activeElement === target && typeof target.blur === "function") target.blur();
    } catch (errBlur) {}
    var before;
    var beforeParents;
    var beforeChrome;
    try {
      before = snap(target);
      beforeParents = snapParents(target);
      beforeChrome = snapChrome(target);
    } catch (err) {
      continue;
    }
    try {
      // Script focus otherwise misses :focus-visible (the usual author ring).
      target.focus({ focusVisible: true });
    } catch (err2) {
      try {
        target.focus();
      } catch (err3) {
        continue;
      }
    }
    var active = document.activeElement;
    if (active !== target && !(target.contains && target.contains(active))) continue;
    var after;
    var afterParents;
    var afterChrome;
    try {
      after = snap(target);
      afterParents = snapParents(target);
      afterChrome = snapChrome(target);
    } catch (err4) {
      continue;
    }
    hits.push({
      name: widgetName(target) || "Control",
      where: describeWhere(target),
      before: before,
      after: after,
      beforeParents: beforeParents,
      afterParents: afterParents,
      beforeChrome: beforeChrome,
      afterChrome: afterChrome
    });
  }
  try {
    if (prev && prev !== document.body && typeof prev.focus === "function") {
      prev.focus({ preventScroll: true });
    } else if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
  } catch (err5) {}
  try {
    window.scrollTo(scrollX, scrollY);
  } catch (err6) {}
  var s;
  for (s = 0; s < overflowScrolls.length; s++) {
    try {
      overflowScrolls[s].el.scrollTop = overflowScrolls[s].top;
      overflowScrolls[s].el.scrollLeft = overflowScrolls[s].left;
    } catch (err7) {}
  }
  return hits;
})()`;

export async function scanFocusVisible(page: Page): Promise<QualityIssue[]> {
  const raw = (await page.evaluate(COLLECT_SRC).catch(() => [])) as FocusVisibleHit[];
  if (!Array.isArray(raw)) return [];
  return issuesFromHits(raw);
}
