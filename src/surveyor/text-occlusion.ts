import type { Page } from "playwright";
import type { QualityIssue } from "../schema/quality.js";

export const MAX_HITS = 8;
export const MAX_RECTS = 3;
export const WHERE_MAX = 40;
export const MAX_NODES = 200;

/** Headings, copy, labels, cells — not every span. */
export const CANDIDATE_SELECTOR = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "label",
  "th",
  "td",
  "[role='heading']",
  "legend",
].join(", ");

export type OverlayKind = "listbox" | "menu" | "dialog" | "popover" | "tooltip";

export type TextKind = "Heading" | "Paragraph" | "Label" | "Cell" | "Legend" | "Text";

export type TextOcclusionHit = {
  kind: TextKind | string;
  where: string;
  cover: string;
  probed: number;
  occluded: number;
};

const OVERLAY_KINDS = new Set<string>(["listbox", "menu", "dialog", "popover", "tooltip"]);

export function clipWhere(text: string, max = WHERE_MAX): string {
  const one = String(text || "").replace(/\s+/g, " ").trim();
  if (!one) return "";
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}

export function textKindFromTag(opts: { tag?: string; role?: string }): TextKind {
  const tag = (opts.tag || "").toLowerCase();
  const role = (opts.role || "").toLowerCase();
  if (/^h[1-6]$/.test(tag) || role === "heading") return "Heading";
  if (tag === "p") return "Paragraph";
  if (tag === "label") return "Label";
  if (tag === "th" || tag === "td") return "Cell";
  if (tag === "legend") return "Legend";
  return "Text";
}

export function expectedOverlay(kind: string | undefined | null): boolean {
  return Boolean(kind && OVERLAY_KINDS.has(kind));
}

/** Off-screen or zero-size ink is not a probe. */
export function rectUsable(
  r: { left: number; top: number; right: number; bottom: number },
  vw: number,
  vh: number,
): boolean {
  const width = r.right - r.left;
  const height = r.bottom - r.top;
  if (!(width > 0) || !(height > 0)) return false;
  if (r.bottom <= 0 || r.right <= 0) return false;
  if (r.top >= vh || r.left >= vw) return false;
  return true;
}

export function hitPaints(opts: { visible?: boolean; opacity?: number }): boolean {
  if (opts.visible === false) return false;
  return (opts.opacity ?? 1) > 0;
}

/** Self / ancestor / descendant is stacking of the same box, not a sibling layer. */
export function probeRelated(opts: {
  hitIsSelf?: boolean;
  hitIsAncestor?: boolean;
  hitIsDescendant?: boolean;
}): boolean {
  return Boolean(opts.hitIsSelf || opts.hitIsAncestor || opts.hitIsDescendant);
}

/** `overflow: hidden`/`clip` of an ancestor that does not contain the probe — that's clip. */
export function skipOverflowClip(opts: {
  overflowX?: string;
  overflowY?: string;
  probeInClip?: boolean;
}): boolean {
  const ox = (opts.overflowX || "").toLowerCase();
  const oy = (opts.overflowY || "").toLowerCase();
  const clips = ox === "hidden" || ox === "clip" || oy === "hidden" || oy === "clip";
  if (!clips) return false;
  return opts.probeInClip === false;
}

/** Open dialog/menu covering the page behind it is expected stacking. */
export function skipOpenOverlay(opts: {
  textOverlayId?: number;
  coverOverlay?: string;
  coverOverlayId?: number;
}): boolean {
  if (!expectedOverlay(opts.coverOverlay)) return false;
  return (opts.textOverlayId ?? -1) !== (opts.coverOverlayId ?? -1);
}

export function isStickyChromeCover(opts: {
  tag?: string;
  role?: string;
  position?: string;
  className?: string;
}): boolean {
  return describeCover(opts) === "a sticky bar";
}

export function describeCover(opts: {
  className?: string;
  name?: string;
  tag?: string;
  role?: string;
  position?: string;
}): string {
  const cls = ` ${opts.className || ""} `.toLowerCase();
  if (/\sbadge\s/.test(cls)) return "a badge";
  if (/\schip\s/.test(cls)) return "a chip";
  const tag = (opts.tag || "").toLowerCase();
  const role = (opts.role || "").toLowerCase();
  const pos = (opts.position || "").toLowerCase();
  const sticky = pos === "sticky" || pos === "fixed";
  if (
    sticky &&
    (tag === "header" ||
      tag === "nav" ||
      role === "banner" ||
      role === "navigation" ||
      /\ssticky\s/.test(cls))
  ) {
    return "a sticky bar";
  }
  const name = (opts.name || "").replace(/\s+/g, " ").trim();
  if (name) return name;
  return tag || "another layer";
}

/**
 * Entire cover → high. Partial is skipped (noisy); ≥2 failed rects could be
 * a medium warning, but entirely covered text is the only report we keep.
 */
export function occlusionConfidence(
  probed: number,
  occluded: number,
): "high" | "medium" | undefined {
  if (!(probed > 0) || !(occluded > 0)) return undefined;
  if (occluded === probed) return "high";
  return undefined;
}

export function textOcclusionMessage(kind: string, cover: string): string {
  const k = kind.replace(/\s+/g, " ").trim() || "Text";
  const c = cover.replace(/\s+/g, " ").trim() || "another layer";
  return `${k} is covered by ${c}`;
}

export function textOcclusionIssue(hit: TextOcclusionHit): QualityIssue | undefined {
  if (!hit) return undefined;
  const confidence = occlusionConfidence(hit.probed, hit.occluded);
  if (!confidence) return undefined;
  const where = clipWhere(hit.where);
  const cover = (hit.cover || "").replace(/\s+/g, " ").trim();
  const kind = (hit.kind || "").replace(/\s+/g, " ").trim();
  if (!where || !kind || !cover) return undefined;
  return {
    source: "visual",
    rule: "textOcclusion",
    severity: "warning",
    confidence,
    count: 1,
    where,
    message: textOcclusionMessage(kind, cover),
  };
}

export function issuesFromHits(hits: TextOcclusionHit[]): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(hits)) return issues;
  for (const hit of hits) {
    const issue = textOcclusionIssue(hit);
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
  var MAX_HITS = ${MAX_HITS};
  var MAX_RECTS = ${MAX_RECTS};
  var MAX_NODES = ${MAX_NODES};
  var WHERE_MAX = ${WHERE_MAX};
  var CANDIDATE_SELECTOR = ${JSON.stringify(CANDIDATE_SELECTOR)};
  var vw = window.innerWidth || 0;
  var vh = window.innerHeight || 0;
  var overlays = [];
  var hits = [];
  var seen = {};

  function clipText(s, n) {
    var one = String(s || "").replace(/\\s+/g, " ").trim();
    if (!one) return "";
    return one.length <= n ? one : one.slice(0, n - 1) + "…";
  }

  function shown(el) {
    if (!el) return false;
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return false;
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    }
    var cs = window.getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    if (parseFloat(cs.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    if (r.bottom <= 0 || r.right <= 0) return false;
    if (r.top >= vh || r.left >= vw) return false;
    return true;
  }

  function kindOf(el) {
    var role = (el.getAttribute("role") || "").toLowerCase();
    var tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag) || role === "heading") return "Heading";
    if (tag === "p") return "Paragraph";
    if (tag === "label") return "Label";
    if (tag === "th" || tag === "td") return "Cell";
    if (tag === "legend") return "Legend";
    return "Text";
  }

  function overlayOf(el) {
    var node = el;
    while (node && node !== document.documentElement && node !== document.body) {
      if (!node.getAttribute) {
        node = node.parentElement;
        continue;
      }
      var role = (node.getAttribute("role") || "").toLowerCase();
      var tag = node.tagName ? node.tagName.toLowerCase() : "";
      if (tag === "dialog" && (node.open || node.hasAttribute("open"))) {
        if (shown(node)) return { kind: "dialog", el: node };
      }
      if (role === "dialog" && node.getAttribute("aria-hidden") !== "true" && shown(node)) {
        return { kind: "dialog", el: node };
      }
      if (node.getAttribute("aria-modal") === "true" && node.getAttribute("aria-hidden") !== "true" && shown(node)) {
        return { kind: "dialog", el: node };
      }
      if (role === "tooltip" && shown(node)) return { kind: "tooltip", el: node };
      if (role === "menu" && node.getAttribute("aria-hidden") !== "true" && shown(node)) {
        return { kind: "menu", el: node };
      }
      if (role === "listbox" && node.getAttribute("aria-hidden") !== "true" && shown(node)) {
        return { kind: "listbox", el: node };
      }
      if (node.hasAttribute("popover")) {
        var pop = false;
        try { pop = node.matches(":popover-open"); } catch (e) {}
        if (pop) return { kind: "popover", el: node };
      }
      node = node.parentElement;
    }
    return null;
  }

  function overlayInfo(el) {
    var found = overlayOf(el);
    if (!found) return { overlay: "", overlayId: -1 };
    var id = -1;
    var i;
    for (i = 0; i < overlays.length; i++) {
      if (overlays[i].el === found.el) {
        id = i;
        break;
      }
    }
    if (id < 0) {
      id = overlays.length;
      overlays.push(found);
    }
    return { overlay: found.kind, overlayId: id };
  }

  function describeWhere(el) {
    var text = clipText(el.innerText || "", WHERE_MAX);
    if (text) return text;
    var labelled = el.getAttribute("aria-label");
    if (labelled && labelled.trim()) return clipText(labelled, WHERE_MAX);
    var testid =
      el.getAttribute("data-testid") ||
      el.getAttribute("data-test-id") ||
      el.getAttribute("data-test") ||
      el.getAttribute("data-cy");
    if (testid && testid.trim()) return clipText(testid, WHERE_MAX);
    var id = el.id && String(el.id).trim();
    if (id && id.charAt(0) !== ":") return clipText(id, WHERE_MAX);
    return el.tagName.toLowerCase();
  }

  function coverFromNode(node) {
    if (!node || !node.getAttribute) return "";
    var cls = " " + (node.getAttribute("class") || "") + " ";
    var low = cls.toLowerCase();
    if (low.indexOf(" badge ") >= 0) return "a badge";
    if (low.indexOf(" chip ") >= 0) return "a chip";
    var tag = node.tagName ? node.tagName.toLowerCase() : "";
    var role = (node.getAttribute("role") || "").toLowerCase();
    var pos = window.getComputedStyle(node).position;
    var sticky = pos === "sticky" || pos === "fixed";
    if (
      sticky &&
      (tag === "header" ||
        tag === "nav" ||
        role === "banner" ||
        role === "navigation" ||
        low.indexOf(" sticky ") >= 0)
    ) {
      return "a sticky bar";
    }
    return "";
  }

  function coverFallback(el) {
    var aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return clipText(aria, 40);
    var cls = (el.getAttribute("class") || "").trim().split(/\\s+/)[0];
    if (cls) return clipText(cls, 24);
    var id = el.id && String(el.id).trim();
    if (id && id.charAt(0) !== ":") return clipText(id, 24);
    var text = clipText(el.innerText || "", 24);
    if (text) return text;
    return (el.tagName || "overlay").toLowerCase();
  }

  function stickyChromeCover(top, textEl) {
    var node = top;
    var depth = 0;
    while (node && node !== document.body && node !== document.documentElement && depth < 6) {
      if (textEl.contains(node) || node.contains(textEl)) break;
      if (coverFromNode(node) === "a sticky bar") return true;
      node = node.parentElement;
      depth++;
    }
    return false;
  }

  function describeCover(top, textEl) {
    var node = top;
    var depth = 0;
    while (node && node !== document.body && node !== document.documentElement && depth < 6) {
      if (textEl.contains(node) || node.contains(textEl)) break;
      var named = coverFromNode(node);
      if (named) return named;
      node = node.parentElement;
      depth++;
    }
    return coverFallback(top);
  }

  function clippedByOverflow(el, x, y) {
    var node = el.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      var cs = window.getComputedStyle(node);
      var ox = cs.overflowX;
      var oy = cs.overflowY;
      if (ox === "hidden" || ox === "clip" || oy === "hidden" || oy === "clip") {
        var r = node.getBoundingClientRect();
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) return true;
      }
      node = node.parentElement;
    }
    return false;
  }

  function hitPaints(top) {
    if (!top) return false;
    if (typeof top.checkVisibility === "function") {
      if (!top.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    }
    var cs = window.getComputedStyle(top);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    return parseFloat(cs.opacity) > 0;
  }

  var root = document.querySelector("main, [role='main']") || document.body;
  var nodes = root.querySelectorAll(CANDIDATE_SELECTOR);
  var n = Math.min(nodes.length, MAX_NODES);
  var i;
  for (i = 0; i < n; i++) {
    if (hits.length >= MAX_HITS) break;
    var el = nodes[i];
    if (!shown(el)) continue;
    var text = (el.innerText || "").replace(/\\s+/g, " ").trim();
    if (!text) continue;
    var list = el.getClientRects();
    var probed = 0;
    var occluded = 0;
    var cover = "";
    var textOverlay = overlayInfo(el);
    var r;
    var limit = Math.min(list.length, MAX_RECTS);
    var k;
    for (k = 0; k < limit; k++) {
      r = list[k];
      if (!r || r.width <= 0 || r.height <= 0) continue;
      if (r.bottom <= 0 || r.right <= 0) continue;
      if (r.top >= vh || r.left >= vw) continue;
      var x = r.left + r.width / 2;
      var y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > vw || y > vh) continue;
      if (clippedByOverflow(el, x, y)) continue;
      probed += 1;
      var top = document.elementFromPoint(x, y);
      if (!top) continue;
      if (el === top || el.contains(top) || top.contains(el)) continue;
      if (!hitPaints(top)) continue;
      var coverInfo = overlayInfo(top);
      if (coverInfo.overlay && (textOverlay.overlayId !== coverInfo.overlayId)) continue;
      if (stickyChromeCover(top, el)) continue;
      occluded += 1;
      if (!cover) cover = describeCover(top, el);
    }
    if (probed <= 0 || occluded !== probed) continue;
    var kind = kindOf(el);
    var where = describeWhere(el) || kind;
    var key = kind + "\\0" + where + "\\0" + cover;
    if (seen[key]) continue;
    seen[key] = true;
    hits.push({
      kind: kind,
      where: where,
      cover: cover || "another layer",
      probed: probed,
      occluded: occluded,
    });
  }
  return hits;
})()`;

export async function scanTextOcclusion(page: Page): Promise<QualityIssue[]> {
  const raw = (await page.evaluate(COLLECT_SRC).catch(() => [])) as TextOcclusionHit[];
  if (!Array.isArray(raw)) return [];
  return issuesFromHits(raw);
}
