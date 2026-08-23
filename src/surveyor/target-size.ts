import type { Page } from "playwright";
import type { QualityIssue } from "../schema/quality.js";

/** WCAG 2.5.8 Target Size (Minimum): both axes must be ≥ this. */
export const TARGET_MIN_PX = 24;
/** Both axes below this → high confidence; otherwise medium. */
export const TARGET_HIGH_PX = 20;
export const TARGET_SIZE_CAP = 8;

export type TargetSizeHit = {
  kind: string;
  width: number;
  height: number;
  where: string;
};

const UA_INPUT = new Set(["checkbox", "radio", "file", "range", "color"]);

/** Native UA widgets are exempt from 2.5.8; a wrapping label still counts via targetBox. */
export function isUserAgentInputType(type: string | undefined): boolean {
  return UA_INPUT.has((type ?? "").toLowerCase());
}

export function isUndersizedTarget(width: number, height: number): boolean {
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width >= 1 &&
    height >= 1 &&
    width < TARGET_MIN_PX &&
    height < TARGET_MIN_PX
  );
}

export function targetSizeConfidence(width: number, height: number): "high" | "medium" {
  return width < TARGET_HIGH_PX && height < TARGET_HIGH_PX ? "high" : "medium";
}

export function targetSizeIssue(hit: TargetSizeHit): QualityIssue | undefined {
  if (!hit || typeof hit.kind !== "string" || typeof hit.where !== "string") return undefined;
  const kind = hit.kind.replace(/\s+/g, " ").trim();
  const where = hit.where.replace(/\s+/g, " ").trim();
  if (!kind || !where) return undefined;
  if (typeof hit.width !== "number" || typeof hit.height !== "number") return undefined;
  if (!isUndersizedTarget(hit.width, hit.height)) return undefined;
  const w = Math.round(hit.width);
  const h = Math.round(hit.height);
  return {
    source: "visual",
    rule: "targetSize",
    severity: "warning",
    confidence: targetSizeConfidence(hit.width, hit.height),
    count: 1,
    where,
    message: `${kind} is ${w}×${h}px; WCAG 2.5.8 minimum is 24×24`,
  };
}

export function issuesFromTargetHits(hits: TargetSizeHit[]): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(hits)) return issues;
  for (const hit of hits) {
    const issue = targetSizeIssue(hit);
    if (!issue) continue;
    const key = `${issue.where}\0${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
    if (issues.length >= TARGET_SIZE_CAP) break;
  }
  return issues;
}

/**
 * Browser-side. Source string so tsx/esbuild `__name` helpers are not
 * serialized into the page.
 */
const COLLECT_SRC = `(() => {
  var MIN = ${TARGET_MIN_PX};
  var MAX_HITS = ${TARGET_SIZE_CAP};
  var SEL = "button, [role='button'], a[href], input:not([type='hidden']), select, textarea, [role='tab'], [role='menuitem']";
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

  function disabled(el) {
    if (el.disabled) return true;
    if (el.getAttribute("aria-disabled") === "true") return true;
    if (typeof el.matches === "function" && el.matches(":disabled")) return true;
    return false;
  }

  function collapsedMenu(el) {
    var role = (el.getAttribute("role") || "").toLowerCase();
    if (role !== "menuitem") return false;
    var menu = el.closest("[role='menu'], [role='menubar']");
    if (!menu) return false;
    if (menu.hasAttribute("hidden") || menu.getAttribute("aria-hidden") === "true") return true;
    if (!shown(menu)) return true;
    if (menu.getAttribute("aria-expanded") === "false") return true;
    var id = menu.id;
    if (id) {
      var inv = document.querySelector("[aria-controls='" + id + "'], [aria-owns='" + id + "']");
      if (inv && inv.getAttribute("aria-expanded") === "false") return true;
    }
    return false;
  }

  function buttonLooking(el) {
    if ((el.getAttribute("role") || "").toLowerCase() === "button") return true;
    var cs = window.getComputedStyle(el);
    var display = cs.display;
    if (display === "flex" || display === "inline-flex" || display === "grid" || display === "inline-grid") {
      return true;
    }
    var bg = cs.backgroundColor;
    if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") return true;
    var pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    var bw = parseFloat(cs.borderTopWidth) || 0;
    var bordered = bw >= 1 && cs.borderTopStyle && cs.borderTopStyle !== "none";
    if (display !== "inline" && (pad >= 8 || bordered)) return true;
    return false;
  }

  function inlineTextLink(el) {
    if (el.tagName.toLowerCase() !== "a") return false;
    if (!el.hasAttribute("href")) return false;
    if (buttonLooking(el)) return false;
    var cs = window.getComputedStyle(el);
    return cs.display === "inline";
  }

  function meetsMin(w, h) {
    return w >= MIN && h >= MIN;
  }

  function bumpFrom(el, box) {
    if (!el) return;
    var r = el.getBoundingClientRect();
    if (!meetsMin(r.width, r.height)) return;
    box.width = Math.max(box.width, r.width);
    box.height = Math.max(box.height, r.height);
  }

  function targetBox(el) {
    var r = el.getBoundingClientRect();
    var box = { width: r.width, height: r.height };
    var wrap = el.closest("label");
    if (wrap && wrap !== el) bumpFrom(wrap, box);
    if (el.id) {
      try {
        var esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(el.id) : el.id;
        bumpFrom(document.querySelector('label[for="' + esc + '"]'), box);
      } catch (err) {}
    }
    return box;
  }

  function kindName(el) {
    var role = (el.getAttribute("role") || "").toLowerCase();
    var tag = el.tagName.toLowerCase();
    if (role === "tab") return "Tab";
    if (role === "menuitem") return "Menu item";
    if (role === "button" || tag === "button") return "Button";
    if (tag === "a") return "Link";
    if (tag === "select") return "Select";
    if (tag === "textarea") return "Textarea";
    if (tag === "input") {
      var t = (el.type || "text").toLowerCase();
      if (t === "submit" || t === "button" || t === "image" || t === "reset") return "Button";
      return "Input";
    }
    return "Control";
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

  var nodes = document.querySelectorAll(SEL);
  var n;
  for (n = 0; n < nodes.length; n++) {
    var el = nodes[n];
    if (!shown(el) || disabled(el) || collapsedMenu(el) || inlineTextLink(el)) continue;
    var tag = el.tagName.toLowerCase();
    if (tag === "input") {
      var itype = (el.type || "").toLowerCase();
      if (itype === "hidden" || itype === "checkbox" || itype === "radio" || itype === "file" || itype === "range" || itype === "color") continue;
    }
    var box = targetBox(el);
    if (!isFinite(box.width) || !isFinite(box.height)) continue;
    if (box.width >= MIN || box.height >= MIN) continue;
    if (box.width < 1 || box.height < 1) continue;
    var where = describeWhere(el);
    var kind = kindName(el);
    var key = kind + "\\0" + where + "\\0" + Math.round(box.width) + "x" + Math.round(box.height);
    if (seen[key]) continue;
    seen[key] = true;
    hits.push({ kind: kind, width: box.width, height: box.height, where: where });
    if (hits.length >= MAX_HITS) break;
  }
  return hits;
})()`;

export async function scanTargetSize(page: Page): Promise<QualityIssue[]> {
  const hits = (await page.evaluate(COLLECT_SRC).catch(() => [])) as TargetSizeHit[];
  return issuesFromTargetHits(hits);
}
