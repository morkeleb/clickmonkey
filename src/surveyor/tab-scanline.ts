import type { Page } from "playwright";
import type { QualityIssue } from "../schema/quality.js";

/** Content-edge jitter at or below this is not scanline. */
export const SCAN_PX = 16;
/** Spread at or above this is high confidence. */
export const HIGH_PX = 28;
/** Tabs whose heights differ by more than this are not one strip. */
export const HEIGHT_TOL_PX = 12;
/** Tabs whose tops fall within this share a horizontal strip. */
export const ROW_TOP_PX = 8;
export const MAX_HITS = 8;

export type TabScanBox = {
  /** Text / content left (Range, else padding-adjusted). */
  left: number;
  /** Tab border-box left; horizontal strips compare insets against this. */
  tabLeft: number;
  top: number;
  height: number;
};

export type TabScanSample = {
  where?: string;
  boxes: TabScanBox[];
};

/**
 * Browser-side. Collect tablists — not menus or nested lists inside menus.
 * Source string so tsx/esbuild `__name` helpers are not serialized into the page.
 */
const COLLECT_SRC = `(() => {
  var groups = [];

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

  function inMenu(el) {
    return Boolean(
      el.closest("[role='menu'], [role='listbox'], [role='tree'], [role='combobox']"),
    );
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

  function paddingLeft(el) {
    var r = el.getBoundingClientRect();
    var cs = window.getComputedStyle(el);
    return r.left + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0);
  }

  function firstTextLeft(el) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var raw = node.nodeValue || "";
      if (!raw.replace(/\\s+/g, "")) continue;
      var range = document.createRange();
      try { range.selectNodeContents(node); } catch (err) { continue; }
      var rects = range.getClientRects();
      if (!rects || rects.length === 0) continue;
      var line = rects[0];
      if (line.width < 1 && line.height < 1) continue;
      return line.left;
    }
    return paddingLeft(el);
  }

  var lists = document.querySelectorAll("[role='tablist'], [role='tabs']");
  var li;
  for (li = 0; li < lists.length; li++) {
    var list = lists[li];
    if (!shown(list) || inMenu(list)) continue;
    var nodes = list.querySelectorAll("[role='tab']");
    var boxes = [];
    var i;
    for (i = 0; i < nodes.length; i++) {
      var tab = nodes[i];
      if (!shown(tab) || inMenu(tab)) continue;
      var host = tab.closest("[role='tablist'], [role='tabs']");
      if (host !== list) continue;
      var r = tab.getBoundingClientRect();
      boxes.push({
        left: firstTextLeft(tab),
        tabLeft: r.left,
        top: r.top,
        height: r.height,
      });
    }
    if (boxes.length < 3) continue;
    groups.push({ where: whereOf(list, "tabs"), boxes: boxes });
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

/** Three or more tabs share a top → a horizontal strip. */
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

/** Title inset from the tab box; used on a horizontal strip. */
export function titleInset(box: TabScanBox): number {
  return box.left - box.tabLeft;
}

export function tabScanlineIssue(sample: TabScanSample): QualityIssue | undefined {
  if (!sample || !Array.isArray(sample.boxes)) return undefined;
  const similar = similarHeightBoxes(sample.boxes);
  if (similar.length < 3) return undefined;
  const horizontal = isHorizontalRow(similar);
  if (!horizontal && isStaggeredGrid(similar.map((b) => b.tabLeft))) return undefined;
  const values = horizontal ? similar.map(titleInset) : similar.map((b) => b.left);
  const spread = edgeSpread(values);
  if (spread <= SCAN_PX) return undefined;
  const where = sample.where?.trim() || "tabs";
  return {
    source: "visual",
    rule: "scanline",
    severity: "warning",
    confidence: spread >= HIGH_PX ? "high" : "medium",
    count: 1,
    where,
    message: "Tab titles do not share a left edge",
  };
}

export function tabScanlineIssues(samples: TabScanSample[]): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const seen = new Set<string>();
  for (const sample of samples) {
    const issue = tabScanlineIssue(sample);
    if (!issue) continue;
    const key = `${issue.message}\0${issue.where ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
    if (issues.length >= MAX_HITS) break;
  }
  return issues;
}

export async function scanTabScanline(page: Page): Promise<QualityIssue[]> {
  const raw = (await page.evaluate(COLLECT_SRC).catch(() => [])) as TabScanSample[];
  if (!Array.isArray(raw)) return [];
  const samples: TabScanSample[] = [];
  for (const s of raw) {
    if (!s || !Array.isArray(s.boxes)) continue;
    samples.push(s);
  }
  return tabScanlineIssues(samples);
}
