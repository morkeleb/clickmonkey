import type { Page } from "playwright";
import type { QualityIssue } from "../schema/quality.js";

/** Intersection must be at least this on both axes to count as overlap. */
export const OVERLAP_MIN_PX = 8;
/** High confidence when the overlap is at least this on both axes. */
export const OVERLAP_HIGH_PX = 16;
export const MAX_OVERLAP_HITS = 8;

export type OverlayKind = "listbox" | "menu" | "dialog" | "popover";

export type ActableKind =
  | "button"
  | "submit"
  | "link"
  | "input"
  | "select"
  | "textarea"
  | "tab"
  | "menuitem";

export type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type CoverHit = {
  covered: boolean;
  /** testid / id / landmark / tag of the node at the control's center. */
  by?: string;
  /** elementFromPoint landed on a different named actable control. */
  byNamedControl?: boolean;
  coverOverlay?: OverlayKind;
  coverOverlayId?: number;
};

export type WidgetSample = {
  name: string;
  kind: ActableKind;
  rect: Rect;
  opacity?: number;
  /** Indexes of actable widgets that DOM-contain this one. */
  parentIds?: number[];
  overlay?: OverlayKind;
  overlayId?: number;
  /** `[role=menuitem]` inside an open `[role=menu]` — not actable here. */
  inOpenMenu?: boolean;
  hit?: CoverHit;
};

const ACTABLE_KINDS = new Set<string>([
  "button",
  "submit",
  "link",
  "input",
  "select",
  "textarea",
  "tab",
  "menuitem",
]);

const OVERLAY_KINDS = new Set<string>(["listbox", "menu", "dialog", "popover", "tooltip"]);
const CHROME_COVER = new Set(["header", "footer", "nav", "navigation"]);

/**
 * Browser-side. Source string so tsx/esbuild `__name` helpers are not
 * serialized into the page.
 */
const COLLECT_SRC = `(() => {
  var ACTABLE_SEL = "button, a[href], input:not([type='hidden']), select, textarea, [role='button'], [role='link'], [role='tab'], [role='menuitem']";
  var MAX_WIDGETS = 200;
  var vw = window.innerWidth || 0;
  var vh = window.innerHeight || 0;
  var overlays = [];
  var items = [];

  function clipText(s, n) {
    var one = String(s || "").replace(/\\s+/g, " ").trim();
    if (!one) return "";
    return one.length <= n ? one : one.slice(0, n - 1) + "…";
  }

  function shown(el) {
    if (!el) return false;
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
    if (!el || !el.tagName) return "";
    var tag = el.tagName.toLowerCase();
    var role = (el.getAttribute("role") || "").toLowerCase();
    var type = tag === "input" ? (el.type || "text").toLowerCase() : "";
    if (type === "hidden") return "";
    if (role === "menuitem") return "menuitem";
    if (role === "tab") return "tab";
    if (role === "button") return "button";
    if (role === "link") return "link";
    if (tag === "button") return "button";
    if (tag === "a") return el.hasAttribute("href") ? "link" : "";
    if (tag === "select") return "select";
    if (tag === "textarea") return "textarea";
    if (tag === "input") {
      if (type === "submit") return "submit";
      if (type === "button" || type === "reset" || type === "image") return "button";
      return "input";
    }
    return "";
  }

  function widgetName(el) {
    var aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return clipText(aria, 40);
    var labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      var text = labelledBy.split(/\\s+/).map(function (id) {
        var hit = document.getElementById(id);
        return hit ? hit.innerText : "";
      }).join(" ").trim();
      if (text) return clipText(text, 40);
    }
    var text = (el.innerText || el.value || "").replace(/\\s+/g, " ").trim();
    if (text) return clipText(text, 40);
    var testid = el.getAttribute("data-testid");
    if (testid && testid.trim()) return clipText(testid, 40);
    if (el.id && String(el.id).trim()) return clipText(el.id, 40);
    var named = el.getAttribute("name") || el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("alt");
    if (named && named.trim()) return clipText(named, 40);
    return el.tagName.toLowerCase();
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
      if (role === "tooltip" && shown(node)) {
        return { kind: "tooltip", el: node };
      }
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

  function visibleRect(el) {
    var r = el.getBoundingClientRect();
    return {
      left: Math.max(r.left, 0),
      top: Math.max(r.top, 0),
      right: Math.min(r.right, vw),
      bottom: Math.min(r.bottom, vh),
    };
  }

  function coverName(top) {
    if (top.closest && top.closest("header, [role='banner']")) return "header";
    if (top.closest && top.closest("footer, [role='contentinfo']")) return "footer";
    return widgetName(top);
  }

  function isNamedControl(el) {
    var node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      var kind = kindOf(node);
      if (kind) {
        var n = widgetName(node);
        return Boolean(n && n !== node.tagName.toLowerCase());
      }
      node = node.parentElement;
    }
    return false;
  }

  function readHit(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return { covered: false };
    var x = r.left + r.width / 2;
    var y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > vw || y > vh) return { covered: false };
    var top = document.elementFromPoint(x, y);
    if (!top) return { covered: false };
    if (el === top || el.contains(top) || top.contains(el)) return { covered: false };
    if (typeof top.checkVisibility === "function") {
      if (!top.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return { covered: false };
    }
    var coverCs = window.getComputedStyle(top);
    if (parseFloat(coverCs.opacity) === 0) return { covered: false };
    var cover = overlayInfo(top);
    var by = coverName(top);
    var hit = {
      covered: true,
      by: by,
      byNamedControl: isNamedControl(top),
    };
    if (cover.overlay) {
      hit.coverOverlay = cover.overlay;
      hit.coverOverlayId = cover.overlayId;
    }
    return hit;
  }

  var nodes = document.querySelectorAll(ACTABLE_SEL);
  var i;
  for (i = 0; i < nodes.length && items.length < MAX_WIDGETS; i++) {
    var el = nodes[i];
    var kind = kindOf(el);
    if (!kind) continue;
    if (!shown(el)) continue;
    var box = visibleRect(el);
    if (box.right - box.left <= 0 || box.bottom - box.top <= 0) continue;
    var info = overlayInfo(el);
    var inOpenMenu = kind === "menuitem" && info.overlay === "menu";
    items.push({
      el: el,
      name: widgetName(el) || kind,
      kind: kind,
      rect: box,
      overlay: info.overlay,
      overlayId: info.overlayId,
      inOpenMenu: inOpenMenu,
    });
  }

  for (i = 0; i < items.length; i++) {
    var pids = [];
    var j;
    for (j = 0; j < items.length; j++) {
      if (i === j) continue;
      if (items[j].el.contains(items[i].el)) pids.push(j);
    }
    items[i].parentIds = pids;
    items[i].hit = items[i].inOpenMenu ? { covered: false } : readHit(items[i].el);
  }

  var out = [];
  for (i = 0; i < items.length; i++) {
    var it = items[i];
    var row = {
      name: it.name,
      kind: it.kind,
      rect: it.rect,
      parentIds: it.parentIds,
      inOpenMenu: it.inOpenMenu,
      hit: it.hit,
    };
    if (it.overlay) {
      row.overlay = it.overlay;
      row.overlayId = it.overlayId;
    }
    out.push(row);
  }
  return out;
})()`;

export function expectedOverlay(kind: string | undefined | null): boolean {
  return Boolean(kind && OVERLAY_KINDS.has(kind));
}

export function rectWidth(r: Rect): number {
  return r.right - r.left;
}

export function rectHeight(r: Rect): number {
  return r.bottom - r.top;
}

export function intersectRects(a: Rect, b: Rect): Rect | undefined {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right <= left || bottom <= top) return undefined;
  return { left, top, right, bottom };
}

/** True when `outer` fully covers `inner` and is strictly larger on at least one axis. */
export function rectContains(outer: Rect, inner: Rect): boolean {
  if (
    outer.left > inner.left ||
    outer.top > inner.top ||
    outer.right < inner.right ||
    outer.bottom < inner.bottom
  ) {
    return false;
  }
  return rectWidth(inner) < rectWidth(outer) || rectHeight(inner) < rectHeight(outer);
}

export function overlapConfidence(width: number, height: number): "high" | "medium" {
  return width >= OVERLAP_HIGH_PX && height >= OVERLAP_HIGH_PX ? "high" : "medium";
}

export function zIndexSeverity(kind: ActableKind): "error" | "warning" {
  return kind === "link" ? "warning" : "error";
}

function validRect(r: Rect | undefined): r is Rect {
  return Boolean(
    r &&
      Number.isFinite(r.left) &&
      Number.isFinite(r.top) &&
      Number.isFinite(r.right) &&
      Number.isFinite(r.bottom),
  );
}

function stackId(id: number | undefined): number {
  return id ?? -1;
}

function usable(w: WidgetSample): boolean {
  if (!ACTABLE_KINDS.has(w.kind)) return false;
  if ((w.opacity ?? 1) === 0) return false;
  if (!validRect(w.rect)) return false;
  if (rectWidth(w.rect) <= 0 || rectHeight(w.rect) <= 0) return false;
  if (w.inOpenMenu) return false;
  return true;
}

function isParentChild(a: WidgetSample, b: WidgetSample, i: number, j: number): boolean {
  if (a.parentIds?.includes(j) || b.parentIds?.includes(i)) return true;
  return false;
}

function widgetLabel(w: WidgetSample): string {
  const name = w.name?.replace(/\s+/g, " ").trim();
  return name || w.kind;
}

export function issuesFromWidgets(widgets: WidgetSample[]): QualityIssue[] {
  const hits: QualityIssue[] = [];
  const n = widgets.length;
  let overlapHits = 0;
  let zHits = 0;
  for (let i = 0; i < n; i++) {
    const a = widgets[i];
    if (!a || !usable(a)) continue;
    for (let j = i + 1; j < n; j++) {
      const b = widgets[j];
      if (!b || !usable(b)) continue;
      if (isParentChild(a, b, i, j)) continue;
      if (stackId(a.overlayId) !== stackId(b.overlayId)) continue;
      if (rectContains(a.rect, b.rect) || rectContains(b.rect, a.rect)) continue;
      const inter = intersectRects(a.rect, b.rect);
      if (!inter) continue;
      const width = rectWidth(inter);
      const height = rectHeight(inter);
      if (width < OVERLAP_MIN_PX || height < OVERLAP_MIN_PX) continue;
      const nameA = widgetLabel(a);
      const nameB = widgetLabel(b);
      hits.push({
        source: "visual",
        rule: "overlap",
        severity: "warning",
        confidence: overlapConfidence(width, height),
        count: 1,
        where: `${nameA}, ${nameB}`,
        message: `${nameA} and ${nameB} occupy the same pixels`,
      });
      overlapHits += 1;
      if (overlapHits >= MAX_OVERLAP_HITS) break;
    }
    if (overlapHits >= MAX_OVERLAP_HITS) break;
  }
  for (let i = 0; i < n; i++) {
    const w = widgets[i];
    if (!w || !usable(w)) continue;
    const hit = w.hit;
    if (!hit?.covered || !hit.by) continue;
    const by = hit.by.replace(/\s+/g, " ").trim() || "overlay";
    if (CHROME_COVER.has(by.toLowerCase())) continue;
    if (expectedOverlay(hit.coverOverlay) && stackId(w.overlayId) !== stackId(hit.coverOverlayId)) {
      continue;
    }
    const name = widgetLabel(w);
    hits.push({
      source: "visual",
      rule: "zIndex",
      severity: zIndexSeverity(w.kind),
      confidence: hit.byNamedControl ? "high" : "medium",
      count: 1,
      where: `${name} covered by ${by}`,
      message: `${name} is covered by ${by}`,
    });
    zHits += 1;
    if (zHits >= MAX_OVERLAP_HITS) break;
  }
  return hits;
}

export async function scanOverlap(page: Page): Promise<QualityIssue[]> {
  const raw = (await page.evaluate(COLLECT_SRC).catch(() => [])) as WidgetSample[];
  if (!Array.isArray(raw)) return [];
  return issuesFromWidgets(raw);
}
