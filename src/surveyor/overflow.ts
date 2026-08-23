import type { Page } from "playwright";
import type { QualityIssue } from "../schema/quality.js";

/** Leak of this many CSS pixels is overflow, not subpixel noise. */
export const OVERFLOW_PX = 8;
/**
 * Document is wider when scrollWidth beats clientWidth by more than this.
 * ~15px is a classic vertical-scrollbar / `100vw` false positive.
 */
export const DOCUMENT_X_SLACK = 16;
export const MAX_OVERFLOW_HITS = 8;
/** Open dialogs below this share of the viewport width are overlays, not pages. */
export const DIALOG_PAGE_SHARE = 0.7;

export type OverflowBox = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type OverflowKind = "document" | "viewport" | "container";

export type OverflowSample = {
  where: string;
  px: number;
  kind: OverflowKind;
  label?: string;
  parentWhere?: string;
};

export function isIntendedScroll(overflowX: string): boolean {
  return overflowX === "auto" || overflowX === "scroll";
}

export function isClippedOverflow(overflowX: string): boolean {
  return overflowX === "hidden" || overflowX === "clip";
}

/** Parent overflow-x that contains the child (scroll or clip — not a leak). */
export function xOverflowContained(overflowX: string): boolean {
  return isIntendedScroll(overflowX) || isClippedOverflow(overflowX);
}

export function isDocumentXOverflow(scrollWidth: number, clientWidth: number): boolean {
  return scrollWidth > clientWidth + DOCUMENT_X_SLACK;
}

export function documentOverflowPx(scrollWidth: number, clientWidth: number): number {
  return scrollWidth - clientWidth;
}

export function viewportCrossPx(
  box: OverflowBox,
  vw: number,
  vh: number,
): { right: number; bottom: number } {
  return { right: box.right - vw, bottom: box.bottom - vh };
}

export function crossesViewportEdge(
  box: OverflowBox,
  vw: number,
  vh: number,
  minPx = OVERFLOW_PX,
): boolean {
  const { right, bottom } = viewportCrossPx(box, vw, vh);
  return right >= minPx || bottom >= minPx;
}

/** How far a child sticks out of, or is wider than, its parent. */
export function childWiderPx(child: OverflowBox, parent: OverflowBox): number {
  const childW = child.right - child.left;
  const parentW = parent.right - parent.left;
  return Math.max(child.right - parent.right, childW - parentW);
}

/** Skip nav/header chrome that is fixed/sticky and fully on-screen. */
export function isFixedChromeInViewport(opts: {
  tag: string;
  role?: string;
  position: string;
  box: OverflowBox;
  vw: number;
  vh: number;
}): boolean {
  const tag = opts.tag.toLowerCase();
  const role = (opts.role ?? "").toLowerCase();
  const chrome =
    tag === "nav" ||
    tag === "header" ||
    tag === "aside" ||
    tag === "footer" ||
    role === "navigation" ||
    role === "banner" ||
    role === "complementary" ||
    role === "contentinfo";
  if (!chrome) return false;
  if (opts.position !== "fixed" && opts.position !== "sticky") return false;
  return (
    opts.box.left >= -1 &&
    opts.box.top >= -1 &&
    opts.box.right <= opts.vw + 1 &&
    opts.box.bottom <= opts.vh + 1
  );
}

/** Overlay dialogs — not almost-page shells we should measure inside. */
export function isSmallOpenDialog(box: OverflowBox, vw: number): boolean {
  return box.right - box.left < vw * DIALOG_PAGE_SHARE;
}

export function overflowConfidence(sample: OverflowSample): "high" | "medium" | undefined {
  if (!Number.isFinite(sample.px)) return undefined;
  if (sample.kind === "document") {
    if (sample.px <= DOCUMENT_X_SLACK) return undefined;
    return sample.px >= 40 ? "high" : "medium";
  }
  if (sample.px < OVERFLOW_PX) return undefined;
  if (sample.kind === "viewport") return "high";
  if (sample.kind === "container") return "medium";
  return undefined;
}

export function overflowMessage(sample: OverflowSample): string {
  const px = Math.round(sample.px);
  if (sample.kind === "document") return `Page is ${px}px wider than the viewport`;
  const name = sample.label?.trim() || sample.where.trim() || "Content";
  const past =
    sample.parentWhere?.trim() ||
    (sample.kind === "viewport" ? "the viewport" : "its container");
  return `${name} extends ${px}px past ${past}`;
}

export function overflowLayoutIssue(
  sample: OverflowSample | null | undefined,
): QualityIssue | undefined {
  if (!sample || !sample.where?.trim()) return undefined;
  const confidence = overflowConfidence(sample);
  if (!confidence) return undefined;
  return {
    source: "visual",
    rule: "overflow",
    severity: confidence === "high" ? "error" : "warning",
    message: overflowMessage(sample),
    count: 1,
    confidence,
    where: sample.where.trim(),
  };
}

export function takeOverflowHits<T extends { px: number }>(
  hits: T[],
  max = MAX_OVERFLOW_HITS,
): T[] {
  return hits.slice().sort((a, b) => b.px - a.px).slice(0, max);
}

/**
 * Browser-side. Source string so tsx/esbuild `__name` helpers are not
 * serialized into the page.
 */
const COLLECT_SRC = `(() => {
  var OVERFLOW_PX = ${OVERFLOW_PX};
  var DOCUMENT_X_SLACK = ${DOCUMENT_X_SLACK};
  var MAX_HITS = ${MAX_OVERFLOW_HITS};
  var DIALOG_PAGE_SHARE = ${DIALOG_PAGE_SHARE};
  var SKIP = {
    SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, NOSCRIPT: 1, TEMPLATE: 1,
    HEAD: 1, BR: 1, WBR: 1, SOURCE: 1, TRACK: 1, IFRAME: 1,
  };
  var vw = window.innerWidth || 0;
  var vh = window.innerHeight || 0;

  function shown(el) {
    if (!el) return false;
    if (el.closest && el.closest("[inert], [aria-hidden='true']")) return false;
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    }
    var r = el.getBoundingClientRect();
    if (r.width < 4 && r.height < 4) return false;
    if (r.bottom <= 0 || r.right <= 0) return false;
    if (r.left >= vw || r.top >= vh) return false;
    return true;
  }

  function clipText(s, n) {
    var one = String(s || "").replace(/\\s+/g, " ").trim();
    if (!one) return "";
    return one.length <= n ? one : one.slice(0, n - 1) + "…";
  }

  function firstClass(el) {
    if (!el || !el.classList || el.classList.length === 0) return "";
    return el.classList[0] || "";
  }

  function elWhere(el) {
    var testid =
      el.getAttribute("data-testid") ||
      el.getAttribute("data-test-id") ||
      el.getAttribute("data-cy") ||
      el.getAttribute("data-test");
    if (testid && testid.trim()) return clipText(testid.trim(), 40);
    var id = el.getAttribute("id");
    if (id && id.trim() && id.charAt(0) !== ":") return clipText(id.trim(), 40);
    var tag = (el.tagName || "el").toLowerCase();
    var cls = firstClass(el);
    if (cls) return tag + "." + clipText(cls, 24);
    if (/^h[1-6]$/.test(tag) && el.innerText) {
      var heading = clipText(el.innerText, 40);
      if (heading) return heading;
    }
    var labelled = el.getAttribute("aria-label");
    if (labelled && labelled.trim()) return clipText(labelled.trim(), 40);
    var h = el.querySelector ? el.querySelector("h1, h2, h3, [role='heading']") : null;
    if (h && h.innerText) return clipText(h.innerText, 40);
    return tag;
  }

  function elLabel(el) {
    var tag = (el.tagName || "").toLowerCase();
    if (/^h[1-6]$/.test(tag) && el.innerText) return clipText(el.innerText, 40);
    var h = el.querySelector ? el.querySelector("h1, h2, h3, [role='heading']") : null;
    if (h && h.innerText) return clipText(h.innerText, 40);
    var aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return clipText(aria.trim(), 40);
    var text = clipText(el.innerText, 40);
    if (text && text.length <= 32) return text;
    return elWhere(el);
  }

  function parentWhere(parent) {
    if (!parent || !parent.tagName) return "its container";
    var tag = parent.tagName.toLowerCase();
    if (tag === "main" || parent.getAttribute("role") === "main") return "the main pane";
    var testid = parent.getAttribute("data-testid");
    if (testid && testid.trim()) return clipText(testid.trim(), 40);
    var id = parent.getAttribute("id");
    if (id && id.trim() && id.charAt(0) !== ":") return clipText(id.trim(), 40);
    return "its container";
  }

  function isChromeEl(el) {
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "nav" || tag === "header" || tag === "aside" || tag === "footer") return true;
    var role = (el.getAttribute("role") || "").toLowerCase();
    return role === "navigation" || role === "banner" || role === "complementary" || role === "contentinfo";
  }

  function skipFixedChrome(el) {
    var n = el;
    while (n && n !== document.body && n !== document.documentElement) {
      if (isChromeEl(n)) {
        var cs = window.getComputedStyle(n);
        var pos = cs.position;
        if (pos === "fixed" || pos === "sticky") {
          var r = n.getBoundingClientRect();
          if (r.left >= -1 && r.top >= -1 && r.right <= vw + 1 && r.bottom <= vh + 1) return true;
        }
      }
      n = n.parentElement;
    }
    return false;
  }

  function xContained(el) {
    var p = el.parentElement;
    while (p && p.nodeType === 1) {
      var ox = window.getComputedStyle(p).overflowX;
      if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") return true;
      if (p === document.documentElement) break;
      p = p.parentElement;
    }
    return false;
  }

  function yContained(el) {
    var p = el.parentElement;
    while (p && p.nodeType === 1) {
      var oy = window.getComputedStyle(p).overflowY;
      if (oy === "auto" || oy === "scroll" || oy === "hidden" || oy === "clip") return true;
      if (p === document.documentElement) break;
      p = p.parentElement;
    }
    return false;
  }

  function xOverflowSkip(ox) {
    return ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip";
  }

  function openDialogs() {
    var nodes = document.querySelectorAll("dialog[open], [role='dialog']");
    var out = [];
    var i;
    for (i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.getAttribute("aria-hidden") === "true") continue;
      if (typeof el.checkVisibility === "function") {
        if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      }
      var r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 80) continue;
      out.push({ el: el, box: r, small: r.width < vw * DIALOG_PAGE_SHARE });
    }
    return out;
  }

  function inSmallDialog(el, dialogs) {
    var i;
    for (i = 0; i < dialogs.length; i++) {
      if (dialogs[i].small && (dialogs[i].el === el || dialogs[i].el.contains(el))) return true;
    }
    return false;
  }

  function largeDialog(dialogs) {
    var i;
    for (i = 0; i < dialogs.length; i++) {
      if (!dialogs[i].small) return dialogs[i];
    }
    return null;
  }

  var dialogs = openDialogs();
  var large = largeDialog(dialogs);
  var root = large ? large.el : document.body;
  if (!root) return [];
  var paneRight = large ? large.box.right : vw;
  var paneBottom = large ? large.box.bottom : vh;

  var pageX;
  if (large) {
    pageX = root.scrollWidth - root.clientWidth;
  } else {
    var doc = document.documentElement;
    var body = document.body;
    pageX = Math.max(
      doc.scrollWidth - doc.clientWidth,
      body ? body.scrollWidth - body.clientWidth : 0,
    );
  }
  var pageScrollsX = pageX > DOCUMENT_X_SLACK;

  var raw = [];
  var byEl = [];

  function kindRank(kind) {
    if (kind === "document") return 2;
    if (kind === "viewport") return 1;
    return 0;
  }

  function push(el, kind, px, parentName) {
    if (!el || !(px > 0)) return;
    var i;
    for (i = 0; i < byEl.length; i++) {
      if (byEl[i].el === el) {
        if (kindRank(kind) > kindRank(byEl[i].kind) || px > byEl[i].px) {
          byEl[i] = { el: el, kind: kind, px: px, parentWhere: parentName || byEl[i].parentWhere };
        }
        return;
      }
    }
    byEl.push({ el: el, kind: kind, px: px, parentWhere: parentName || "" });
  }

  var nodes = root.querySelectorAll("*");
  var n = Math.min(nodes.length, 4000);
  var bestEl = root === document.body ? null : root;
  var bestRight = bestEl ? bestEl.getBoundingClientRect().right : -Infinity;
  var i;
  for (i = 0; i < n; i++) {
    var el = nodes[i];
    if (SKIP[el.tagName]) continue;
    if (!shown(el)) continue;
    if (inSmallDialog(el, dialogs)) continue;
    if (skipFixedChrome(el)) continue;
    if (large && el === large.el) continue;

    var r = el.getBoundingClientRect();
    if (r.right > bestRight) {
      bestRight = r.right;
      bestEl = el;
    }

    var bleedRight = r.right - paneRight;
    if (!xContained(el) && bleedRight >= OVERFLOW_PX) {
      push(el, "viewport", bleedRight, large ? "the dialog" : "the viewport");
    }

    var cs = window.getComputedStyle(el);
    var pos = cs.position;
    var oy = cs.overflowY;
    var vhTrap = (pos === "fixed" || pos === "sticky") && r.height >= vh - 8;
    if ((large || pos === "fixed" || pos === "sticky") && !vhTrap && oy !== "auto" && oy !== "scroll" && oy !== "hidden") {
      var bleedBottom = r.bottom - paneBottom;
      if (!yContained(el) && bleedBottom >= OVERFLOW_PX) {
        push(el, "viewport", bleedBottom, large ? "the dialog" : "the viewport");
      }
    }

    if (!pageScrollsX) {
      var parent = el.parentElement;
      if (parent && parent !== document.body && parent !== document.documentElement) {
        if (large && parent === large.el) {
          var paneBleed = Math.max(r.right - large.box.right, r.width - parent.clientWidth);
          if (paneBleed >= OVERFLOW_PX && !xContained(el)) {
            push(el, "container", paneBleed, "the dialog");
          }
        } else {
          var pcs = window.getComputedStyle(parent);
          if (!xOverflowSkip(pcs.overflowX)) {
            var pr = parent.getBoundingClientRect();
            var cBleed = Math.max(r.right - pr.right, r.width - parent.clientWidth);
            if (cBleed >= OVERFLOW_PX) {
              push(el, "container", cBleed, parentWhere(parent));
            }
          }
        }
      }
    }
  }

  if (pageScrollsX && bestEl) {
    push(bestEl, "document", pageX, "the viewport");
  }

  byEl.sort(function (a, b) { return b.px - a.px; });
  for (i = 0; i < byEl.length && raw.length < MAX_HITS; i++) {
    var hit = byEl[i];
    var nested = false;
    var j;
    for (j = 0; j < raw.length; j++) {
      if (raw[j].el.contains(hit.el) && hit.px <= raw[j].px + 2) {
        nested = true;
        break;
      }
    }
    if (nested) continue;
    raw.push(hit);
  }

  var out = [];
  for (i = 0; i < raw.length; i++) {
    out.push({
      where: elWhere(raw[i].el),
      px: Math.round(raw[i].px),
      kind: raw[i].kind,
      label: elLabel(raw[i].el),
      parentWhere: raw[i].parentWhere || "",
    });
  }
  return out;
})()`;

export async function scanOverflow(page: Page): Promise<QualityIssue[]> {
  const hits = (await page.evaluate(COLLECT_SRC).catch(() => [])) as OverflowSample[];
  const issues: QualityIssue[] = [];
  if (!Array.isArray(hits)) return issues;
  for (const hit of takeOverflowHits(hits)) {
    const issue = overflowLayoutIssue(hit);
    if (issue) issues.push(issue);
  }
  return issues;
}
