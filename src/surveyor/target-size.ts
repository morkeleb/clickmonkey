import type { Page } from "playwright";
import type { QualityIssue } from "../schema/quality.js";
import { evidenceClipFromRect, type EvidenceClip, type ShotClip } from "./focus-visible.js";

/** WCAG 2.5.8 Target Size (Minimum): both axes must be ≥ this. */
export const TARGET_MIN_PX = 24;
/** Both axes below this → high confidence; otherwise medium. */
export const TARGET_HIGH_PX = 20;
export const TARGET_SIZE_CAP = 8;
/**
 * Below this is sr-only / 1×1 native select under a custom combobox, not a
 * pointer target. 2.5.8 is about painted controls people try to tap.
 */
export const TARGET_PAINTED_MIN_PX = 4;

export type TargetSizeHit = {
  kind: string;
  width: number;
  height: number;
  where: string;
  clip?: ShotClip;
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
    width >= TARGET_PAINTED_MIN_PX &&
    height >= TARGET_PAINTED_MIN_PX &&
    width < TARGET_MIN_PX &&
    height < TARGET_MIN_PX
  );
}

export type TargetRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type Circle24 = {
  cx: number;
  cy: number;
  r: number;
};

/** Sample from the page: hit fields plus the control's bounding box. */
export type TargetSizeSample = TargetSizeHit &
  TargetRect & {
    /** UA widget, inline text link, or disabled — neighbor only, never a hit. */
    exempt?: boolean;
  };

/** WCAG 2.5.8 spacing circle: 24px diameter, centered on the target. */
export function circle24(cx: number, cy: number): Circle24 {
  return { cx, cy, r: TARGET_MIN_PX / 2 };
}

function centerOf(rect: TargetRect): { cx: number; cy: number } {
  return { cx: (rect.left + rect.right) / 2, cy: (rect.top + rect.bottom) / 2 };
}

/** True when the open disk around (cx, cy) overlaps rect (tangent does not count). */
export function circleHitsRect(cx: number, cy: number, r: number, rect: TargetRect): boolean {
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r) || r < 0) return false;
  const x = Math.max(rect.left, Math.min(cx, rect.right));
  const y = Math.max(rect.top, Math.min(cy, rect.bottom));
  const dx = cx - x;
  const dy = cy - y;
  return dx * dx + dy * dy < r * r;
}

/**
 * True when a 24px circle centered on `target` misses every other actable rect
 * (any size) and every other undersized target's 24px circle. Tangent = pass.
 */
export function spacingExceptionHolds(target: TargetRect, others: readonly TargetRect[]): boolean {
  const { cx, cy } = centerOf(target);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return false;
  const { r } = circle24(cx, cy);
  const minSq = TARGET_MIN_PX * TARGET_MIN_PX;
  for (const other of others) {
    if (!other) continue;
    if (circleHitsRect(cx, cy, r, other)) return false;
    const ow = other.right - other.left;
    const oh = other.bottom - other.top;
    if (!isUndersizedTarget(ow, oh)) continue;
    const o = centerOf(other);
    const dx = cx - o.cx;
    const dy = cy - o.cy;
    if (dx * dx + dy * dy < minSq) return false;
  }
  return true;
}

function sampleRect(sample: TargetSizeSample): TargetRect | undefined {
  if (!sample || typeof sample !== "object") return undefined;
  const { left, top, right, bottom } = sample;
  if (![left, top, right, bottom].every((n) => typeof n === "number" && Number.isFinite(n))) {
    return undefined;
  }
  return { left, top, right, bottom };
}

/** Keep undersized hits; drop those whose 24px spacing circle misses every other actable. */
export function dropSpacedHits(samples: TargetSizeSample[]): TargetSizeHit[] {
  if (!Array.isArray(samples)) return [];
  const rects = samples.map(sampleRect);
  const hits: TargetSizeHit[] = [];
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    if (!sample || typeof sample !== "object") continue;
    if (sample.exempt) continue;
    if (!isUndersizedTarget(sample.width, sample.height)) continue;
    const target = rects[i];
    if (!target) continue;
    const others: TargetRect[] = [];
    for (let j = 0; j < rects.length; j++) {
      const other = rects[j];
      if (j === i || !other) continue;
      others.push(other);
    }
    if (spacingExceptionHolds(target, others)) continue;
    hits.push({
      kind: sample.kind,
      width: sample.width,
      height: sample.height,
      where: sample.where,
      clip: {
        x: target.left,
        y: target.top,
        width: target.right - target.left,
        height: target.bottom - target.top,
      },
    });
  }
  return hits;
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
  return targetSizeEvidence(hits).issues;
}

export function targetSizeEvidence(
  hits: TargetSizeHit[],
  viewport?: { width: number; height: number } | null,
): { issues: QualityIssue[]; clips: EvidenceClip[] } {
  const issues: QualityIssue[] = [];
  const clips: EvidenceClip[] = [];
  const seen = new Set<string>();
  const vw = viewport?.width ?? 0;
  const vh = viewport?.height ?? 0;
  if (!Array.isArray(hits)) return { issues, clips };
  for (const hit of hits) {
    const issue = targetSizeIssue(hit);
    if (!issue) continue;
    const key = `${issue.where}\0${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
    if (issue.confidence === "high" && issue.where) {
      const clip = evidenceClipFromRect(hit.clip, vw, vh);
      if (clip) clips.push({ where: issue.where, clip });
    }
    if (issues.length >= TARGET_SIZE_CAP) break;
  }
  return { issues, clips };
}

/**
 * Browser-side. Source string so tsx/esbuild `__name` helpers are not
 * serialized into the page.
 */
const COLLECT_SRC = `(() => {
  var SEL = "button, [role='button'], a[href], input:not([type='hidden']), select, textarea, [role='tab'], [role='menuitem']";
  var TARGET_PAINTED_MIN_PX = ${TARGET_PAINTED_MIN_PX};
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
    if (r.width < TARGET_PAINTED_MIN_PX || r.height < TARGET_PAINTED_MIN_PX) return false;
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

  function targetBox(el) {
    var r = el.getBoundingClientRect();
    var box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    function include(node) {
      if (!node || node === el) return;
      var o = node.getBoundingClientRect();
      if (o.width < 1 || o.height < 1) return;
      box.left = Math.min(box.left, o.left);
      box.top = Math.min(box.top, o.top);
      box.right = Math.max(box.right, o.right);
      box.bottom = Math.max(box.bottom, o.bottom);
    }
    var wrap = el.closest("label");
    if (wrap) include(wrap);
    if (el.id) {
      try {
        var esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(el.id) : el.id;
        include(document.querySelector('label[for="' + esc + '"]'));
      } catch (err) {}
    }
    box.width = box.right - box.left;
    box.height = box.bottom - box.top;
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
    if (!shown(el) || collapsedMenu(el)) continue;
    var tag = el.tagName.toLowerCase();
    var itype = tag === "input" ? (el.type || "").toLowerCase() : "";
    if (itype === "hidden") continue;
    var ua = itype === "checkbox" || itype === "radio" || itype === "file" || itype === "range" || itype === "color";
    var box = targetBox(el);
    if (!isFinite(box.width) || !isFinite(box.height)) continue;
    if (box.width < TARGET_PAINTED_MIN_PX || box.height < TARGET_PAINTED_MIN_PX) continue;
    var where = describeWhere(el);
    var kind = kindName(el);
    var exempt = Boolean(disabled(el) || ua || inlineTextLink(el));
    var key = kind + "\\0" + where + "\\0" + Math.round(box.width) + "x" + Math.round(box.height) + (exempt ? "\\0x" : "");
    if (seen[key]) continue;
    seen[key] = true;
    hits.push({
      kind: kind,
      width: box.width,
      height: box.height,
      where: where,
      left: box.left,
      top: box.top,
      right: box.right,
      bottom: box.bottom,
      exempt: exempt,
    });
  }
  return hits;
})()`;

export async function scanTargetSizeEvidence(page: Page): Promise<{
  issues: QualityIssue[];
  clips: EvidenceClip[];
}> {
  const samples = (await page.evaluate(COLLECT_SRC).catch(() => [])) as TargetSizeSample[];
  return targetSizeEvidence(dropSpacedHits(samples), page.viewportSize());
}

export async function scanTargetSize(page: Page): Promise<QualityIssue[]> {
  return (await scanTargetSizeEvidence(page)).issues;
}
