import type { Page } from "playwright";
import type { QualityIssue } from "../schema/quality.js";

/** Content-edge jitter at or below this is not scanline. */
export const SCAN_PX = 16;
/** Spread at or above this is high confidence. */
export const HIGH_PX = 28;
/** Row siblings must share a height band this wide. */
export const HEIGHT_TOL_PX = 12;
/** Items whose tops fall within this are a horizontal row, not a column. */
export const ROW_TOP_PX = 8;
export const MAX_HITS = 8;

export type ListScanKind = "titles" | "icons" | "actions" | "values";

export type ListScanBox = {
  left: number;
  right: number;
  top: number;
  height: number;
  /** Parent row's border-box left; used to skip multi-column grids. */
  rowLeft?: number;
};

export type ListScanSample = {
  kind: ListScanKind;
  where?: string;
  boxes: ListScanBox[];
};

/** ⌘K / Ctrl+K — not an amount. Keep this tight so "$12.00" and labels stay values. */
const SHORTCUT_TEXT =
  /^(?:[⌘⌃⌥⇧]|ctrl|control|cmd|command|alt|option|shift|super|win|meta)(?:\s*[+–-]?\s*.{1,6})?$/i;

export function looksLikeShortcutText(text: string): boolean {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 16) return false;
  return SHORTCUT_TEXT.test(t);
}

/** Tailwind `ml-auto` / `ms-auto`, or an inline margin-left:auto. Computed used value is px. */
export function looksLikeAutoStartMargin(opts: { className?: string; style?: string }): boolean {
  const cls = opts.className ?? "";
  if (/(^|\s)(ml|ms)-auto(\s|$)/.test(cls)) return true;
  return /margin-(?:left|inline-start)\s*:\s*auto/i.test(opts.style ?? "");
}

/**
 * Keyboard-shortcut chrome on a row (Search ⌘K). Not a trailing amount.
 * `<kbd>` is enough; a chord plus start-auto margin covers a span without `<kbd>`.
 */
export function looksLikeShortcutChrome(opts: {
  tag?: string;
  className?: string;
  style?: string;
  text?: string;
  inKbd?: boolean;
}): boolean {
  const tag = (opts.tag || "").toLowerCase();
  if (tag === "kbd" || opts.inKbd) return true;
  if (!looksLikeShortcutText(opts.text ?? "")) return false;
  return looksLikeAutoStartMargin(opts);
}

/**
 * Browser-side. Collect repeating list/nav/card rows — not tables.
 * Source string so tsx/esbuild `__name` helpers are not serialized into the page.
 */
const COLLECT_SRC = `(() => {
  var groups = [];
  var seenFeat = [];

  function shown(el) {
    if (!el) return false;
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    }
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    if (r.bottom <= 0 || r.right <= 0) return false;
    if (r.top >= (window.innerHeight || 0) || r.left >= (window.innerWidth || 0)) return false;
    return true;
  }

  function inTable(el) {
    return Boolean(el.closest("table, [role='table'], [role='grid']"));
  }

  function inMenu(el) {
    return Boolean(
      el.closest("[role='menu'], [role='listbox'], [role='tree'], [role='combobox']"),
    );
  }

  function skipHost(el) {
    return inTable(el) || inMenu(el);
  }

  function clipText(s, n) {
    var one = String(s || "").replace(/\\s+/g, " ").trim();
    if (!one) return "";
    return one.length <= n ? one : one.slice(0, n - 1) + "…";
  }

  function whereOf(el, fallback) {
    var labelled = (el.getAttribute("aria-label") || "").trim();
    if (labelled) return clipText(labelled, 40);
    var testid = (el.getAttribute("data-testid") || "").trim();
    if (testid) return clipText(testid, 40);
    var labelledBy = (el.getAttribute("aria-labelledby") || "").trim();
    if (labelledBy) {
      var ids = labelledBy.split(/\\s+/);
      var parts = [];
      var i;
      for (i = 0; i < ids.length; i++) {
        var n = document.getElementById(ids[i]);
        if (n && n.innerText) parts.push(n.innerText);
      }
      var joined = parts.join(" ").replace(/\\s+/g, " ").trim();
      if (joined) return clipText(joined, 40);
    }
    var cap = el.querySelector(":scope > h1, :scope > h2, :scope > h3, :scope > caption, :scope > legend");
    if (cap && cap.innerText) return clipText(cap.innerText, 40);
    var prev = el.previousElementSibling;
    if (prev && /^H[1-6]$/.test(prev.tagName) && prev.innerText) return clipText(prev.innerText, 40);
    return fallback;
  }

  function featureBox(el, rowLeft) {
    var r = el.getBoundingClientRect();
    var cs = window.getComputedStyle(el);
    return {
      left: r.left + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0),
      right: r.right - (parseFloat(cs.paddingRight) || 0) - (parseFloat(cs.borderRightWidth) || 0),
      top: r.top,
      height: r.height,
      rowLeft: rowLeft,
    };
  }

  function pickTitle(item) {
    var h = item.querySelector("h1, h2, h3, h4, h5, h6, [role='heading']");
    if (h && shown(h) && !skipHost(h)) return h;
    if (item.matches && item.matches("a, [role='link']")) return item;
    var a = item.querySelector("a, [role='link']");
    if (a && shown(a) && !skipHost(a)) return a;
    return null;
  }

  function pickIcon(item) {
    var nodes = item.querySelectorAll("svg, img, [class*='icon']");
    var i;
    for (i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!shown(el) || skipHost(el)) continue;
      var r = el.getBoundingClientRect();
      if (r.width > 48 || r.height > 48) continue;
      if (r.width < 8 || r.height < 8) continue;
      return el;
    }
    return null;
  }

  function pickAction(item) {
    var title = pickTitle(item);
    var nodes = item.querySelectorAll("button, [role='button']");
    var last = null;
    var i;
    for (i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!shown(el) || skipHost(el) || el === item || el === title) continue;
      last = el;
    }
    return last;
  }

  function slotsOf(el) {
    var kids = [];
    var ch = el.children || [];
    var i;
    for (i = 0; i < ch.length; i++) {
      if (!shown(ch[i]) || skipHost(ch[i])) continue;
      kids.push({ el: ch[i], box: ch[i].getBoundingClientRect() });
    }
    if (kids.length < 2) return null;
    kids.sort(function (a, b) { return a.box.left - b.box.left; });
    var seed = kids[0];
    var row = [seed];
    for (i = 1; i < kids.length; i++) {
      var overlap = Math.min(seed.box.bottom, kids[i].box.bottom) - Math.max(seed.box.top, kids[i].box.top);
      if (overlap > 4) row.push(kids[i]);
    }
    return row.length >= 2 ? row : null;
  }

  function pickTrack(item) {
    var s = slotsOf(item);
    if (s) return s;
    var ch = item.children || [];
    var i;
    for (i = 0; i < ch.length; i++) {
      if (!shown(ch[i]) || skipHost(ch[i])) continue;
      s = slotsOf(ch[i]);
      if (s) return s;
    }
    return null;
  }

  function isShortcutChrome(el) {
    if (!el) return false;
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "kbd") return true;
    if (el.closest && el.closest("kbd")) return true;
    var cls = (el.getAttribute && el.getAttribute("class")) || "";
    var style = (el.getAttribute && el.getAttribute("style")) || "";
    var t = (el.innerText || "").replace(/\\s+/g, " ").trim();
    if (!t || t.length > 16) return false;
    var auto = /(^|\\s)(ml|ms)-auto(\\s|$)/.test(cls) || /margin-(?:left|inline-start)\\s*:\\s*auto/i.test(style);
    if (!auto) return false;
    return /^(?:[⌘⌃⌥⇧]|ctrl|control|cmd|command|alt|option|shift|super|win|meta)(?:\\s*[+–-]?\\s*.{1,6})?$/i.test(t);
  }

  /** Trailing token on the row — amounts/meta shoved by a variable-width title. */
  function pickValue(item) {
    var title = pickTitle(item);
    var action = pickAction(item);
    var icon = pickIcon(item);
    var track = pickTrack(item);
    var last = track && track.length >= 2 ? track[track.length - 1].el : null;
    var lastInTitle = Boolean(title && last && title.contains && title.contains(last));
    if (
      last &&
      last !== title &&
      last !== action &&
      last !== icon &&
      last !== item &&
      !lastInTitle &&
      !isShortcutChrome(last)
    ) {
      var t = (last.innerText || "").replace(/\\s+/g, " ").trim();
      if (t) return last;
    }
    if (!title) return null;
    var tr = title.getBoundingClientRect();
    var nodes = item.querySelectorAll("span, p, time, data, strong, em, small, b, kbd");
    var best = null;
    var bestLeft = -Infinity;
    var i;
    for (i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!shown(el) || skipHost(el) || el === title || el === action || el === icon) continue;
      if (title.contains && title.contains(el)) continue;
      if (isShortcutChrome(el)) continue;
      var r = el.getBoundingClientRect();
      if (r.left < tr.right + 4) continue;
      var txt = (el.innerText || "").replace(/\\s+/g, " ").trim();
      if (!txt || txt.length > 40) continue;
      if (r.left > bestLeft) {
        bestLeft = r.left;
        best = el;
      }
    }
    return best;
  }

  function pushGroup(kind, where, rows, pick) {
    var boxes = [];
    var feats = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var feat = pick(rows[i].el);
      if (!feat || !shown(feat) || skipHost(feat)) continue;
      if (seenFeat.indexOf(feat) >= 0) continue;
      feats.push(feat);
      boxes.push(featureBox(feat, rows[i].box.left));
    }
    if (boxes.length < 3) return;
    for (i = 0; i < feats.length; i++) seenFeat.push(feats[i]);
    groups.push({ kind: kind, where: where, boxes: boxes });
  }

  function scanRows(rows, where) {
    if (rows.length < 3) return;
    pushGroup("titles", where, rows, pickTitle);
    pushGroup("icons", where, rows, pickIcon);
    pushGroup("actions", where, rows, pickAction);
    pushGroup("values", where, rows, pickValue);
  }

  function visibleRows(nodes) {
    var rows = [];
    var i;
    for (i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!shown(el) || skipHost(el)) continue;
      rows.push({ el: el, box: el.getBoundingClientRect() });
    }
    return rows;
  }

  var lists = document.querySelectorAll("[role='list'], ul, ol");
  var li;
  for (li = 0; li < lists.length; li++) {
    var list = lists[li];
    if (!shown(list) || skipHost(list)) continue;
    var items = list.querySelectorAll(":scope > [role='listitem'], :scope > li");
    scanRows(visibleRows(items), whereOf(list, "list"));
  }

  var cards = document.querySelectorAll("article, [class~='card']");
  var byParent = [];
  var parentEls = [];
  var k;
  for (k = 0; k < cards.length; k++) {
    var card = cards[k];
    if (!shown(card) || skipHost(card)) continue;
    if (card.closest("ul, ol, [role='list']")) continue;
    var parent = card.parentElement;
    if (!parent) continue;
    var idx = parentEls.indexOf(parent);
    if (idx < 0) {
      parentEls.push(parent);
      byParent.push([]);
      idx = parentEls.length - 1;
    }
    byParent[idx].push({ el: card, box: card.getBoundingClientRect() });
  }
  for (k = 0; k < byParent.length; k++) {
    scanRows(byParent[k], whereOf(parentEls[k], "cards"));
  }

  return groups;
})()`;

export function edgeSpread(values: number[]): number {
  if (values.length === 0) return 0;
  let min = values[0]!;
  let max = values[0]!;
  for (let i = 1; i < values.length; i++) {
    const v = values[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return max - min;
}

/** Largest subset whose heights differ by at most HEIGHT_TOL_PX. */
export function similarHeightBoxes<T extends { height: number }>(boxes: T[]): T[] {
  if (boxes.length === 0) return [];
  const sorted = boxes.slice().sort((a, b) => a.height - b.height);
  let bestStart = 0;
  let bestEnd = 0;
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1]!.height - sorted[i]!.height <= HEIGHT_TOL_PX) {
      j += 1;
    }
    if (j - i > bestEnd - bestStart) {
      bestStart = i;
      bestEnd = j;
    }
  }
  return sorted.slice(bestStart, bestEnd + 1);
}

/** Three or more items share a top → a menubar / grid row, not a column. */
export function isHorizontalRow(boxes: Array<{ top: number }>): boolean {
  if (boxes.length < 3) return false;
  for (let i = 0; i < boxes.length; i++) {
    const top = boxes[i]!.top;
    let n = 0;
    for (let j = 0; j < boxes.length; j++) {
      if (Math.abs(boxes[j]!.top - top) <= ROW_TOP_PX) n += 1;
    }
    if (n >= 3) return true;
  }
  return false;
}

/** Cluster values that sit within SCAN_PX of the cluster minimum. */
export function leftClusters(lefts: number[]): number[][] {
  if (lefts.length === 0) return [];
  const sorted = lefts.slice().sort((a, b) => a - b);
  const clusters: number[][] = [];
  let cur: number[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const v = sorted[i]!;
    if (v - cur[0]! <= SCAN_PX) cur.push(v);
    else {
      clusters.push(cur);
      cur = [v];
    }
  }
  clusters.push(cur);
  return clusters;
}

/**
 * Multi-column grid or masonry: two populated left-edge clusters, or
 * several singleton lefts with no column of three.
 */
export function isStaggeredGrid(lefts: number[]): boolean {
  if (lefts.length < 3) return false;
  const clusters = leftClusters(lefts);
  let populated = 0;
  let largest = 0;
  for (const c of clusters) {
    if (c.length >= 2) populated += 1;
    if (c.length > largest) largest = c.length;
  }
  if (populated >= 2) return true;
  if (largest < 3 && clusters.length >= 3 && lefts.length >= 5) return true;
  return false;
}

function kindLabel(kind: ListScanKind): string {
  if (kind === "icons") return "Row icons";
  if (kind === "actions") return "Row actions";
  if (kind === "values") return "Row values";
  return "Row titles";
}

export function listScanlineIssue(sample: ListScanSample): QualityIssue | undefined {
  if (!sample || !Array.isArray(sample.boxes)) return undefined;
  const similar = similarHeightBoxes(sample.boxes);
  if (similar.length < 3) return undefined;
  if (isHorizontalRow(similar)) return undefined;
  const rowLefts = similar.map((b) => (typeof b.rowLeft === "number" ? b.rowLeft : b.left));
  if (isStaggeredGrid(rowLefts)) return undefined;
  if (sample.kind === "values") {
    const leftSpread = edgeSpread(similar.map((b) => b.left));
    const rightSpread = edgeSpread(similar.map((b) => b.right));
    // Right-locked amounts (space-between / grid) share a right edge while
    // lefts move with title width — that is a column, not a break.
    if (rightSpread <= SCAN_PX || leftSpread <= SCAN_PX) return undefined;
    const where = sample.where?.trim() || "row values";
    return {
      source: "visual",
      rule: "scanline",
      severity: "warning",
      confidence: Math.max(leftSpread, rightSpread) >= HIGH_PX ? "high" : "medium",
      count: 1,
      where,
      message: `${kindLabel("values")} do not share a left edge`,
    };
  }
  const edge = sample.kind === "actions" ? "right" : "left";
  const values = similar.map((b) => (edge === "right" ? b.right : b.left));
  const spread = edgeSpread(values);
  if (spread <= SCAN_PX) return undefined;
  const label = kindLabel(sample.kind);
  const where = sample.where?.trim() || label.toLowerCase();
  return {
    source: "visual",
    rule: "scanline",
    severity: "warning",
    confidence: spread >= HIGH_PX ? "high" : "medium",
    count: 1,
    where,
    message: `${label} do not share a ${edge} edge`,
  };
}

export function listScanlineIssues(samples: ListScanSample[]): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const seen = new Set<string>();
  for (const sample of samples) {
    const issue = listScanlineIssue(sample);
    if (!issue) continue;
    const key = `${issue.message}\0${issue.where ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
    if (issues.length >= MAX_HITS) break;
  }
  return issues;
}

export async function scanListScanline(page: Page): Promise<QualityIssue[]> {
  const raw = (await page.evaluate(COLLECT_SRC).catch(() => [])) as ListScanSample[];
  if (!Array.isArray(raw)) return [];
  const samples: ListScanSample[] = [];
  for (const s of raw) {
    if (!s || (s.kind !== "titles" && s.kind !== "icons" && s.kind !== "actions" && s.kind !== "values")) continue;
    if (!Array.isArray(s.boxes)) continue;
    samples.push(s);
  }
  return listScanlineIssues(samples);
}
