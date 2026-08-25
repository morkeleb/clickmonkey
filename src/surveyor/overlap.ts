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
  /** Header, nav, aside, top strip, or left rail — same chrome on every page. */
  inChrome?: boolean;
  hit?: CoverHit;
};

export const CHROME_OVERLAP_MESSAGE = "Header or nav controls occupy the same pixels";
export const CHROME_COVER_MESSAGE = "A header or nav control is covered";

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
    return Boolean(visibleRect(el));
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
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "select" && el.options && el.selectedIndex >= 0) {
      var opt = el.options[el.selectedIndex];
      var selected = opt ? String(opt.text || opt.label || "").replace(/\\s+/g, " ").trim() : "";
      if (selected) return clipText(selected, 40);
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
    box.left = Math.max(box.left, 0);
    box.top = Math.max(box.top, 0);
    box.right = Math.min(box.right, vw);
    box.bottom = Math.min(box.bottom, vh);
    if (box.right - box.left < ${OVERLAP_MIN_PX} || box.bottom - box.top < ${OVERLAP_MIN_PX}) return null;
    return box;
  }

  function inChrome(el) {
    if (!el) return false;
    if (el.closest && el.closest("header, nav, aside, [role='banner'], [role='navigation'], [role='complementary']")) {
      return true;
    }
    var r = el.getBoundingClientRect();
    if (r.top >= 0 && r.top < 56) return true;
    if (r.left >= 0 && r.left < 72 && r.width < vw * 0.45) return true;
    return false;
  }

  function coverName(top) {
    if (top.closest && top.closest("header, [role='banner']")) return "header";
    if (top.closest && top.closest("footer, [role='contentinfo']")) return "footer";
    var node = top;
    while (node && node !== document.body && node !== document.documentElement) {
      if (kindOf(node)) return widgetName(node);
      node = node.parentElement;
    }
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
    var box = visibleRect(el);
    if (!box) return { covered: false };
    var x = (box.left + box.right) / 2;
    var y = (box.top + box.bottom) / 2;
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
    if (!box) continue;
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
      inChrome: inChrome(it.el),
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

/**
 * Paint box: overflow:hidden/auto/scroll/clip ancestors (then the viewport).
 * Scrolled-off tab chips keep a layout rect in the sidebar; they must not.
 */
export function clipRectByClips(box: Rect, clips: readonly Rect[], minPx = OVERLAP_MIN_PX): Rect | undefined {
  let out: Rect = { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
  for (const c of clips) {
    const next = intersectRects(out, c);
    if (!next) return undefined;
    out = next;
  }
  if (rectWidth(out) < minPx || rectHeight(out) < minPx) return undefined;
  return out;
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

function nameContainsOption(a: string, b: string): boolean {
  const x = a.toLowerCase().replace(/\s+/g, " ").trim();
  const y = b.toLowerCase().replace(/\s+/g, " ").trim();
  if (x.length < 4 || y.length < 4) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return long.includes(short);
}

/** Visible value vs closed list whose innerText still concatenates the options. */
function optionListCoversValue(name: string, by: string): boolean {
  const x = name.toLowerCase().replace(/\s+/g, " ").trim();
  const y = by.toLowerCase().replace(/\s+/g, " ").trim();
  if (y.length < 4 || x.length <= y.length) return false;
  if (!(x.startsWith(`${y} `) || x.endsWith(` ${y}`) || x.includes(` ${y} `))) return false;
  const extra = ` ${x} `.replace(` ${y} `, " ").trim();
  return extra.split(" ").filter(Boolean).length >= 2;
}

function coveringWidget(widgets: WidgetSample[], w: WidgetSample, by: string): WidgetSample | undefined {
  const want = by.toLowerCase().replace(/\s+/g, " ").trim();
  for (const other of widgets) {
    if (other === w || !usable(other)) continue;
    if (widgetLabel(other).toLowerCase().replace(/\s+/g, " ").trim() === want) return other;
  }
  return undefined;
}

/** Native &lt;select&gt; under a custom trigger, or option text vs concatenated option list. */
export function isStackedSelectPair(a: WidgetSample, b: WidgetSample): boolean {
  const inter = intersectRects(a.rect, b.rect);
  if (!inter) return false;
  const area = (r: Rect) => rectWidth(r) * rectHeight(r);
  const smaller = Math.min(area(a.rect), area(b.rect));
  if (smaller <= 0) return false;
  if (area(inter) / smaller < 0.6) return false;
  if (a.kind === "select" || b.kind === "select") return true;
  return nameContainsOption(widgetLabel(a), widgetLabel(b));
}

/** Closed filter/select: option-list innerText hit-tested onto the visible value. */
function isClosedSelectCover(w: WidgetSample, by: string, widgets: WidgetSample[]): boolean {
  if (optionListCoversValue(widgetLabel(w), by)) return true;
  const cover = coveringWidget(widgets, w, by);
  return Boolean(cover && isStackedSelectPair(w, cover));
}

function widgetLabel(w: WidgetSample): string {
  const name = w.name?.replace(/\s+/g, " ").trim();
  return name || w.kind;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

function overlapIssue(a: WidgetSample, b: WidgetSample, width: number, height: number): QualityIssue {
  const nameA = widgetLabel(a);
  const nameB = widgetLabel(b);
  const chrome = Boolean(a.inChrome && b.inChrome);
  return {
    source: "visual",
    rule: "overlap",
    severity: "warning",
    confidence: overlapConfidence(width, height),
    count: 1,
    where: `${nameA}, ${nameB}`,
    message: chrome ? CHROME_OVERLAP_MESSAGE : `${nameA} and ${nameB} occupy the same pixels`,
  };
}

function zIndexIssue(w: WidgetSample, by: string, byNamedControl: boolean | undefined): QualityIssue {
  const name = widgetLabel(w);
  return {
    source: "visual",
    rule: "zIndex",
    severity: zIndexSeverity(w.kind),
    confidence: byNamedControl ? "high" : "medium",
    count: 1,
    where: `${name} covered by ${by}`,
    message: w.inChrome ? CHROME_COVER_MESSAGE : `${name} is covered by ${by}`,
  };
}

export function issuesFromWidgets(widgets: WidgetSample[]): QualityIssue[] {
  const hits: QualityIssue[] = [];
  const overlapPairs = new Set<string>();
  const n = widgets.length;
  let overlapHits = 0;
  let zHits = 0;
  const pushOverlap = (chromeFirst: boolean): void => {
    if (overlapHits >= MAX_OVERLAP_HITS) return;
    for (let i = 0; i < n; i++) {
      const a = widgets[i];
      if (!a || !usable(a)) continue;
      for (let j = i + 1; j < n; j++) {
        const b = widgets[j];
        if (!b || !usable(b)) continue;
        if (Boolean(a.inChrome && b.inChrome) !== chromeFirst) continue;
        if (isParentChild(a, b, i, j)) continue;
        if (isStackedSelectPair(a, b)) continue;
        if (stackId(a.overlayId) !== stackId(b.overlayId)) continue;
        if (rectContains(a.rect, b.rect) || rectContains(b.rect, a.rect)) continue;
        const inter = intersectRects(a.rect, b.rect);
        if (!inter) continue;
        const width = rectWidth(inter);
        const height = rectHeight(inter);
        if (width < OVERLAP_MIN_PX || height < OVERLAP_MIN_PX) continue;
        overlapPairs.add(pairKey(widgetLabel(a), widgetLabel(b)));
        hits.push(overlapIssue(a, b, width, height));
        overlapHits += 1;
        if (overlapHits >= MAX_OVERLAP_HITS) return;
      }
    }
  };
  pushOverlap(true);
  pushOverlap(false);
  const chromeOverlap = hits.some((i) => i.rule === "overlap" && i.message === CHROME_OVERLAP_MESSAGE);
  const pushZ = (chromeFirst: boolean): void => {
    if (zHits >= MAX_OVERLAP_HITS) return;
    for (let i = 0; i < n; i++) {
      const w = widgets[i];
      if (!w || !usable(w)) continue;
      if (Boolean(w.inChrome) !== chromeFirst) continue;
      const hit = w.hit;
      if (!hit?.covered || !hit.by) continue;
      const by = hit.by.replace(/\s+/g, " ").trim() || "overlay";
      if (CHROME_COVER.has(by.toLowerCase())) continue;
      if (expectedOverlay(hit.coverOverlay) && stackId(w.overlayId) !== stackId(hit.coverOverlayId)) {
        continue;
      }
      if (overlapPairs.has(pairKey(widgetLabel(w), by))) continue;
      if (w.inChrome && chromeOverlap) continue;
      if (isClosedSelectCover(w, by, widgets)) continue;
      hits.push(zIndexIssue(w, by, hit.byNamedControl));
      zHits += 1;
      if (zHits >= MAX_OVERLAP_HITS) return;
    }
  };
  pushZ(true);
  pushZ(false);
  return hits;
}

export async function scanOverlap(page: Page): Promise<QualityIssue[]> {
  const raw = (await page.evaluate(COLLECT_SRC).catch(() => [])) as WidgetSample[];
  if (!Array.isArray(raw)) return [];
  return issuesFromWidgets(raw);
}
