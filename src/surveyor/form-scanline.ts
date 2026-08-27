import type { Page } from "playwright";
import type { QualityIssue } from "../schema/quality.js";

/** Same bar as list/table scanline: jitter at or below this is not a break. */
export const SCAN_PX = 16;
export const HIGH_PX = 28;
/** Controls whose tops fall within this sit on one row. */
export const ROW_TOP_PX = 12;
/** Loose band that still groups one ragged column (not a second form column). */
export const COLUMN_BAND_PX = 48;
export const MAX_HITS = 12;

/** Split MuiOutlinedInput-root into outlined, input — not "muioutlinedinput root". */
export function fieldChromeClass(className: string | undefined | null): boolean {
  if (!className) return false;
  const tokens = String(className)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[\s._-]+/)
    .filter(Boolean);
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (a === "outlined" && b === "input") return true;
    if (a === "text" && b === "field") return true;
    if (a === "input" && b === "root") return true;
    if (a === "form" && b === "control") return true;
  }
  return false;
}

export type FormFieldSample = {
  name: string;
  controlLeft: number;
  controlRight: number;
  controlTop: number;
  controlBottom: number;
  controlHeight: number;
  labelTop: number;
  labelBottom: number;
  labelLeft: number;
  labelRight: number;
  stacked: boolean;
  side: boolean;
  /** First-line ink top of the label, when measured. */
  labelInkTop?: number;
  /** Glyph/content top of the value (not the control box mid). */
  valueInkTop?: number;
  /** "dialog" or "page" (or dialog index/key if multiple). */
  pane?: string;
  /** Closest card/article/[class~=card]/[class*="MuiPaper"]/section that looks like a settings card; empty if none. */
  cardKey?: string;
  /** Clustering parent has flex-wrap wrap/wrap-reverse. */
  wrap?: boolean;
};

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

/** Side-by-side fields, including one dropped by about a control-height. Wrapped lines, other cards, and other panes are not a row. */
export function onSameRow(a: FormFieldSample, b: FormFieldSample): boolean {
  const hOverlap = Math.min(a.controlRight, b.controlRight) - Math.max(a.controlLeft, b.controlLeft);
  if (hOverlap > 16) return false;
  if (a.pane && b.pane && a.pane !== b.pane) return false;
  if (a.cardKey && b.cardKey && a.cardKey !== b.cardKey) return false;
  if ((a.wrap || b.wrap) && Math.abs(a.controlTop - b.controlTop) > ROW_TOP_PX) return false;
  const slack = Math.max(a.controlHeight, b.controlHeight, 32) + 48;
  return Math.abs(a.controlTop - b.controlTop) <= slack;
}

/**
 * Fields that stack as a column: tops spread, lefts sit in a 48px band.
 * One indented field still belongs to the column so we can measure the break.
 */
export function verticalColumns(
  fields: FormFieldSample[],
  getLeft: (field: FormFieldSample) => number,
): FormFieldSample[][] {
  const sorted = fields
    .filter((f) => Number.isFinite(getLeft(f)))
    .slice()
    .sort((a, b) => getLeft(a) - getLeft(b) || a.controlTop - b.controlTop);
  if (sorted.length < 3) return [];
  const clusters: FormFieldSample[][] = [];
  let cur: FormFieldSample[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const field = sorted[i]!;
    if (getLeft(field) - getLeft(cur[0]!) <= COLUMN_BAND_PX) cur.push(field);
    else {
      clusters.push(cur);
      cur = [field];
    }
  }
  clusters.push(cur);
  return clusters.filter((group) => {
    if (group.length < 3) return false;
    return edgeSpread(group.map((f) => f.controlTop)) > ROW_TOP_PX * 2;
  });
}

function noHorizontalOverlap(a: FormFieldSample, b: FormFieldSample): boolean {
  return Math.min(a.controlRight, b.controlRight) - Math.max(a.controlLeft, b.controlLeft) <= 16;
}

function samePaneAndCard(a: FormFieldSample, b: FormFieldSample): boolean {
  if (a.pane && b.pane && a.pane !== b.pane) return false;
  if (a.cardKey && b.cardKey && a.cardKey !== b.cardKey) return false;
  return true;
}

/** Side-by-side on the same visual row (not the cell below). */
export function hasSidePartner(field: FormFieldSample, fields: readonly FormFieldSample[]): boolean {
  return fields.some((other) => {
    if (other === field) return false;
    if (!samePaneAndCard(field, other)) return false;
    if (Math.abs(other.controlTop - field.controlTop) > SCAN_PX) return false;
    return noHorizontalOverlap(field, other);
  });
}

/**
 * Repeating two-column editor rows (void-reason code | description).
 * Transitive onSameRow slack otherwise treats the whole grid as one dropped row.
 */
export function isFieldGrid(row: FormFieldSample[]): boolean {
  if (row.length < 4) return false;
  let paired = 0;
  for (const field of row) {
    if (hasSidePartner(field, row)) paired += 1;
  }
  return paired >= 4;
}

function pairNames(row: FormFieldSample[]): [string, string] {
  const names = row.map((f) => clipName(f.name)).filter(Boolean);
  return [names[0] || "field", names[1] || names[0] || "field"];
}

/** Cluster fields that share a visual row. */
export function rowClusters(fields: FormFieldSample[]): FormFieldSample[][] {
  const used = new Set<number>();
  const rows: FormFieldSample[][] = [];
  for (let i = 0; i < fields.length; i++) {
    if (used.has(i)) continue;
    const seed = fields[i]!;
    const row = [seed];
    used.add(i);
    for (let j = i + 1; j < fields.length; j++) {
      if (used.has(j)) continue;
      const other = fields[j]!;
      if (onSameRow(seed, other) || row.some((f) => onSameRow(f, other))) {
        row.push(other);
        used.add(j);
      }
    }
    rows.push(row);
  }
  return rows;
}

export function formScanlineIssue(opts: {
  message: string;
  where: string;
  spread: number;
}): QualityIssue | undefined {
  if (opts.spread <= SCAN_PX) return undefined;
  const where = opts.where.replace(/\s+/g, " ").trim();
  const message = opts.message.replace(/\s+/g, " ").trim();
  if (!where || !message) return undefined;
  return {
    source: "visual",
    rule: "scanline",
    severity: "warning",
    confidence: opts.spread >= HIGH_PX ? "high" : "medium",
    count: 1,
    where,
    message,
  };
}

function clipName(name: string): string {
  const one = name.replace(/\s+/g, " ").trim();
  return one.length <= 40 ? one : `${one.slice(0, 39)}…`;
}

export function formScanlineIssues(fields: FormFieldSample[]): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const seen = new Set<string>();
  const push = (issue: QualityIssue | undefined) => {
    if (!issue) return;
    const key = `${issue.message}\0${issue.where}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push(issue);
  };

  for (const row of rowClusters(fields)) {
    if (row.length < 2) continue;
    if (isFieldGrid(row)) continue;
    const spread = edgeSpread(row.map((f) => f.controlTop));
    const [left, right] = pairNames(row);
    push(
      formScanlineIssue({
        spread,
        where: `${left}, ${right}`,
        message: `${left} and ${right} sit on one row but do not line up`,
      }),
    );
    if (issues.length >= MAX_HITS) return issues;
  }

  for (const field of fields) {
    if (!field.side || field.stacked) continue;
    const labelEdge = Number.isFinite(field.labelInkTop)
      ? field.labelInkTop!
      : (field.labelTop + field.labelBottom) / 2;
    const valueEdge = Number.isFinite(field.valueInkTop)
      ? field.valueInkTop!
      : (field.controlTop + field.controlBottom) / 2;
    const spread = Math.abs(labelEdge - valueEdge);
    const name = clipName(field.name);
    push(
      formScanlineIssue({
        spread,
        where: name,
        message: `${name} label does not line up with the field`,
      }),
    );
    if (issues.length >= MAX_HITS) return issues;
  }

  const byName = new Map<string, FormFieldSample[]>();
  for (const field of fields) {
    const key = field.name.replace(/\s+/g, " ").trim().toLowerCase();
    if (!key) continue;
    const list = byName.get(key) ?? [];
    list.push(field);
    byName.set(key, list);
  }
  for (const [name, group] of byName) {
    if (group.length < 3) continue;
    const tops = group.map((f) => f.controlTop);
    const topSpread = edgeSpread(tops);
    if (topSpread <= ROW_TOP_PX * 2) continue;
    const spread = edgeSpread(group.map((f) => f.controlLeft));
    const label = clipName(group[0]?.name || name);
    push(
      formScanlineIssue({
        spread,
        where: label,
        message: `${label} fields do not line up down the column`,
      }),
    );
    if (issues.length >= MAX_HITS) return issues;
    const labelSpread = edgeSpread(group.map((f) => f.labelLeft));
    if (spread <= SCAN_PX) {
      push(
        formScanlineIssue({
          spread: labelSpread,
          where: label,
          message: `${label} labels do not line up down the column`,
        }),
      );
      if (issues.length >= MAX_HITS) return issues;
    }
  }

  for (const col of verticalColumns(fields, (f) => f.controlLeft)) {
    const unique = new Set(col.map((f) => f.name.replace(/\s+/g, " ").trim().toLowerCase()).filter(Boolean));
    if (unique.size <= 1) continue;
    // Two-column details grid: grouping the right (or left) cells as one
    // stacked column flags text vs combobox chrome, not a visible break.
    if (col.every((f) => hasSidePartner(f, fields))) continue;
    const names = col
      .slice()
      .sort((a, b) => a.controlTop - b.controlTop)
      .map((f) => clipName(f.name))
      .filter(Boolean);
    const controlSpread = edgeSpread(col.map((f) => f.controlLeft));
    const labelSpread = edgeSpread(col.map((f) => f.labelLeft));
    const where = names.slice(0, 3).join(", ");
    if (controlSpread > SCAN_PX) {
      push(
        formScanlineIssue({
          spread: controlSpread,
          where,
          message: `${names.slice(0, 2).join(" and ")} do not line up down the column`,
        }),
      );
    } else {
      push(
        formScanlineIssue({
          spread: labelSpread,
          where,
          message: `${names.slice(0, 2).join(" and ")} labels do not line up down the column`,
        }),
      );
    }
    if (issues.length >= MAX_HITS) return issues;
  }

  return issues;
}

/**
 * Browser-side. Source string so tsx/esbuild `__name` helpers are not
 * serialized into the page.
 */
const COLLECT_SRC = `(() => {
  var ROW_TOP_PX = ${ROW_TOP_PX};
  var fields = [];

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

  function inChrome(el) {
    return Boolean(el.closest && el.closest("header, nav, aside, footer, [role='banner'], [role='navigation'], [role='contentinfo']"));
  }

  function clipText(s, n) {
    var one = String(s || "").replace(/\\s+/g, " ").trim();
    if (!one) return "";
    return one.length <= n ? one : one.slice(0, n - 1) + "…";
  }

  function skipControl(el) {
    var tag = (el.tagName || "").toLowerCase();
    var type = (el.type || "").toLowerCase();
    var role = (el.getAttribute("role") || "").toLowerCase();
    if (tag === "input" && (type === "hidden" || type === "checkbox" || type === "radio" || type === "button" || type === "submit" || type === "file" || type === "range" || type === "color")) return true;
    if (role === "tab" || role === "menuitem" || role === "option") return true;
    if (el.closest && el.closest("[role='toolbar'], [role='tablist'], [role='menu']")) return true;
    if (el.disabled) return true;
    if (el.getAttribute("aria-hidden") === "true") return true;
    return false;
  }

  function classTokens(className) {
    var parts = String(className || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[\\s._-]+/);
    var out = [];
    var i;
    for (i = 0; i < parts.length; i++) {
      if (parts[i]) out.push(parts[i]);
    }
    return out;
  }

  function hasChromePair(tokens, a, b) {
    var i;
    for (i = 0; i < tokens.length - 1; i++) {
      if (tokens[i] === a && tokens[i + 1] === b) return true;
    }
    return false;
  }

  function fieldChromeClass(className) {
    var t = classTokens(className);
    return hasChromePair(t, "outlined", "input") || hasChromePair(t, "text", "field") || hasChromePair(t, "input", "root") || hasChromePair(t, "form", "control");
  }

  function overlapSmaller(a, b) {
    var left = Math.max(a.left, b.left);
    var right = Math.min(a.right, b.right);
    var top = Math.max(a.top, b.top);
    var bottom = Math.min(a.bottom, b.bottom);
    if (right <= left || bottom <= top) return 0;
    var inter = (right - left) * (bottom - top);
    var smaller = Math.min(a.width * a.height, b.width * b.height);
    if (smaller <= 0) return 0;
    return inter / smaller;
  }

  function selectCoverButton(sel) {
    var sr = sel.getBoundingClientRect();
    var buttons = document.querySelectorAll("button, [role='button']");
    var best = null;
    var bestScore = 0.6;
    var i;
    for (i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      if (b === sel || !shown(b) || inChrome(b) || skipControl(b)) continue;
      var extra = b.querySelectorAll("input, select, textarea, [role='combobox']");
      var n = 0;
      var j;
      for (j = 0; j < extra.length; j++) {
        if (extra[j] !== sel && !skipControl(extra[j]) && shown(extra[j])) n += 1;
      }
      if (n > 0) continue;
      var score = overlapSmaller(sr, b.getBoundingClientRect());
      if (score >= bestScore) {
        bestScore = score;
        best = b;
      }
    }
    return best;
  }

  function opacityZero(el) {
    try {
      var cs = window.getComputedStyle(el);
      if (cs && (cs.opacity === "0" || Number(cs.opacity) === 0)) return true;
    } catch (err) {}
    return false;
  }

  function nativeSelectObscured(el) {
    if (!shown(el)) return true;
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return true;
    return opacityZero(el);
  }

  function isPaintedTrigger(b) {
    if (!b) return false;
    var t = (b.tagName || "").toLowerCase();
    var role = (b.getAttribute("role") || "").toLowerCase();
    if (t !== "button" && role !== "button") return false;
    if (!shown(b) || inChrome(b) || skipControl(b)) return false;
    return true;
  }

  function uniqueShownButton(root) {
    if (!root) return null;
    var nodes = root.querySelectorAll("button, [role='button']");
    var found = null;
    var i;
    for (i = 0; i < nodes.length; i++) {
      if (!isPaintedTrigger(nodes[i])) continue;
      if (found) return null;
      found = nodes[i];
    }
    if (!found && isPaintedTrigger(root)) return root;
    return found;
  }

  function extraShownFields(root, except) {
    if (!root) return 0;
    var hosts = root.querySelectorAll("input, select, textarea, [role='combobox']");
    var n = 0;
    var i;
    for (i = 0; i < hosts.length; i++) {
      if (hosts[i] === except) continue;
      if (!skipControl(hosts[i]) && shown(hosts[i])) n += 1;
    }
    return n;
  }

  function adjacentPaintedButton(el) {
    if (!el) return null;
    var n = el.nextElementSibling;
    if (isPaintedTrigger(n)) return n;
    var inner = uniqueShownButton(n);
    if (inner && extraShownFields(n, el) === 0) return inner;
    var p = el.previousElementSibling;
    if (isPaintedTrigger(p)) return p;
    inner = uniqueShownButton(p);
    if (inner && extraShownFields(p, el) === 0) return inner;
    return null;
  }

  /** Hidden/sr-only native select: painted trigger, not the 1×1 control. */
  function paintedTrigger(sel) {
    var btn;
    if (sel.id) {
      var lab = null;
      try {
        var esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(sel.id) : sel.id;
        lab = document.querySelector('label[for="' + esc + '"]');
      } catch (err) {}
      if (lab) {
        btn = uniqueShownButton(lab);
        if (btn) return btn;
        btn = adjacentPaintedButton(lab);
        if (btn) return btn;
      }
    }
    var wrap = sel.closest && sel.closest("label");
    if (wrap) {
      btn = uniqueShownButton(wrap);
      if (btn) return btn;
    }
    var cur = sel.parentElement;
    var steps = 0;
    while (cur && steps < 5) {
      var t = (cur.tagName || "").toLowerCase();
      if (t === "form" || t === "td" || t === "tr" || t === "table") break;
      if (cur.getAttribute("role") === "dialog") break;
      if (cur === document.body) break;
      btn = uniqueShownButton(cur);
      if (btn && extraShownFields(cur, sel) === 0) return btn;
      cur = cur.parentElement;
      steps += 1;
    }
    return adjacentPaintedButton(sel);
  }

  function firstLineTop(el) {
    if (!el) return;
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
      return line.top;
    }
  }

  function contentInkTop(el) {
    if (!el) return;
    var r = el.getBoundingClientRect();
    var cs = window.getComputedStyle(el);
    var bt = parseFloat(cs.borderTopWidth) || 0;
    var pt = parseFloat(cs.paddingTop) || 0;
    return r.top + bt + pt;
  }

  /** Outlined / combobox chrome, not the inner native control. */
  function fieldChrome(el) {
    var combo = el.closest && el.closest("[role='combobox']");
    if (combo && shown(combo)) return combo;
    var cur = el;
    var steps = 0;
    var nativeTag = (el.tagName || "").toLowerCase();
    var native = nativeTag === "input" || nativeTag === "select" || nativeTag === "textarea";
    while (cur && steps < 5) {
      var role = (cur.getAttribute("role") || "").toLowerCase();
      var clsName = cur.getAttribute("class");
      var skipSelf = native && cur === el && role !== "combobox";
      if (!skipSelf && shown(cur) && (role === "combobox" || fieldChromeClass(clsName))) {
        var tokens = classTokens(clsName);
        var strong = role === "combobox" || hasChromePair(tokens, "outlined", "input") || hasChromePair(tokens, "text", "field") || hasChromePair(tokens, "input", "root");
        var modestOk = true;
        if (!strong) {
          var pr = cur.getBoundingClientRect();
          var r = el.getBoundingClientRect();
          modestOk = pr.height <= r.height + 36 && pr.width <= r.width + 48 && pr.height >= r.height - 2;
        }
        if (modestOk) return cur;
      }
      cur = cur.parentElement;
      steps += 1;
      if (!cur || cur === document.body) break;
      var tag = (cur.tagName || "").toLowerCase();
      if (tag === "form" || tag === "td" || tag === "tr" || tag === "table") break;
      if (cur.getAttribute("role") === "dialog") break;
    }
    var p = el.parentElement;
    if (p && shown(p)) {
      var pr = p.getBoundingClientRect();
      var r = el.getBoundingClientRect();
      var hosts = p.querySelectorAll("input, select, textarea, [role='combobox']");
      var n = 0;
      var i;
      for (i = 0; i < hosts.length; i++) {
        if (!skipControl(hosts[i]) && shown(hosts[i])) n += 1;
      }
      if (n === 1 && pr.height <= r.height + 36 && pr.width <= r.width + 48 && pr.height >= r.height - 2) return p;
    }
    return el;
  }

  function labelFor(el) {
    if (el.id) {
      var lab = null;
      try {
        var esc = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(el.id) : el.id;
        lab = document.querySelector('label[for="' + esc + '"]');
      } catch (err) {}
      if (lab && shown(lab)) return lab;
    }
    var wrap = el.closest && el.closest("label");
    if (wrap && shown(wrap)) return wrap;
    var labelledBy = (el.getAttribute("aria-labelledby") || "").trim();
    if (labelledBy) {
      var id = labelledBy.split(/\\s+/)[0];
      var n = id ? document.getElementById(id) : null;
      if (n && shown(n)) return n;
    }
    return null;
  }

  function fieldName(el, lab) {
    var t = lab ? (lab.innerText || "").replace(/\\s+/g, " ").trim() : "";
    if (t) return clipText(t, 40);
    var aria = (el.getAttribute("aria-label") || "").trim();
    if (aria) return clipText(aria, 40);
    var ph = (el.getAttribute("placeholder") || "").trim();
    if (ph) return clipText(ph, 40);
    var name = (el.getAttribute("name") || el.getAttribute("data-testid") || "").trim();
    if (name) return clipText(name, 40);
    var tagName = (el.tagName || "").toLowerCase();
    var roleName = (el.getAttribute("role") || "").toLowerCase();
    if (tagName === "button" || roleName === "button") {
      var own = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
      if (own) return clipText(own, 40);
    }
    return "field";
  }

  function headingText(el) {
    if (!el || !el.querySelector) return "";
    var h = el.querySelector("h1, h2, h3, h4, h5, h6, [role='heading']");
    if (!h) return "";
    return clipText((h.innerText || h.textContent || ""), 40);
  }

  function visibleDialogs() {
    var nodes = document.querySelectorAll("dialog[open], [role='dialog']");
    var out = [];
    var i;
    for (i = 0; i < nodes.length; i++) {
      var d = nodes[i];
      if (d.getAttribute("aria-hidden") === "true") continue;
      if (!shown(d)) continue;
      if (d.getBoundingClientRect().width < 80) continue;
      out.push(d);
    }
    return out;
  }

  var openDialogs = visibleDialogs();

  function paneFor(el) {
    if (!openDialogs.length) return "page";
    var i;
    for (i = 0; i < openDialogs.length; i++) {
      if (!openDialogs[i].contains(el)) continue;
      if (openDialogs.length === 1) return "dialog";
      var d = openDialogs[i];
      var key = (d.id || "").trim() || (d.getAttribute("aria-label") || "").trim() || headingText(d) || ("dialog-" + i);
      return clipText(key, 40);
    }
    return "";
  }

  function hasClassToken(el, token) {
    var t = classTokens(el.getAttribute && el.getAttribute("class"));
    var i;
    for (i = 0; i < t.length; i++) if (t[i] === token) return true;
    return false;
  }

  function classHas(el, sub) {
    var raw = (el.getAttribute && el.getAttribute("class")) || "";
    return raw.indexOf(sub) >= 0;
  }

  function siblingCard(el) {
    var tag = (el.tagName || "").toLowerCase();
    if (tag !== "section" && tag !== "div" && tag !== "article") return false;
    if (!headingText(el)) return false;
    var p = el.parentElement;
    if (!p) return false;
    var cs;
    try { cs = window.getComputedStyle(p); } catch (err) { return false; }
    var d = cs && cs.display;
    if (d !== "grid" && d !== "inline-grid" && d !== "flex" && d !== "inline-flex") return false;
    var kids = p.children;
    var n = 0;
    var i;
    for (i = 0; i < kids.length; i++) {
      var kid = kids[i];
      var kt = (kid.tagName || "").toLowerCase();
      if (kt !== "section" && kt !== "div" && kt !== "article") continue;
      if (headingText(kid)) n += 1;
    }
    return n >= 2;
  }

  function isCard(el) {
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "form" || tag === "main" || tag === "body" || tag === "html") return false;
    if (tag === "article") return true;
    if (hasClassToken(el, "card") || hasClassToken(el, "paper")) return true;
    if (classHas(el, "Paper") || classHas(el, "MuiPaper")) return true;
    return siblingCard(el);
  }

  function stableCardKey(el) {
    var id = (el.id || "").trim();
    if (id) return clipText(id, 40);
    var aria = (el.getAttribute("aria-label") || "").trim();
    if (aria) return clipText(aria, 40);
    var title = headingText(el);
    if (title) return title;
    var tag = (el.tagName || "").toLowerCase();
    var raw = ((el.getAttribute("class") || "").trim().split(/\\s+/).slice(0, 2).join("."));
    return clipText(tag + (raw ? "." + raw : ""), 40);
  }

  function cardKeyFor(el) {
    var cur = el;
    var steps = 0;
    while (cur && steps < 16) {
      var tag = (cur.tagName || "").toLowerCase();
      if (tag === "form" || tag === "main" || tag === "body" || tag === "html") return "";
      if (tag === "dialog" || (cur.getAttribute && cur.getAttribute("role") === "dialog")) return "";
      if (isCard(cur)) return stableCardKey(cur);
      cur = cur.parentElement;
      steps += 1;
    }
    return "";
  }

  function wrapFor(el) {
    var cur = el && el.parentElement;
    var steps = 0;
    while (cur && steps < 16) {
      var tag = (cur.tagName || "").toLowerCase();
      if (tag === "body" || tag === "html" || tag === "main") return false;
      var cs;
      try { cs = window.getComputedStyle(cur); } catch (err) { cs = null; }
      if (cs) {
        var d = cs.display;
        var w = cs.flexWrap;
        if ((d === "flex" || d === "inline-flex") && (w === "wrap" || w === "wrap-reverse")) return true;
      }
      cur = cur.parentElement;
      steps += 1;
    }
    return false;
  }

  var nodes = document.querySelectorAll("input, select, textarea, [role='combobox'], [aria-haspopup='listbox']");
  var seenChrome = [];
  var i;
  for (i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    if (inChrome(el) || skipControl(el)) continue;
    var pane = paneFor(el);
    if (openDialogs.length && !pane) continue;
    var tag = (el.tagName || "").toLowerCase();
    var role = (el.getAttribute("role") || "").toLowerCase();
    var chrome = null;
    if (tag === "select") {
      var cover = selectCoverButton(el);
      if (cover) {
        if ((cover.getAttribute("aria-haspopup") || "").toLowerCase() === "listbox") continue;
        chrome = cover;
      } else if (nativeSelectObscured(el)) {
        cover = paintedTrigger(el);
        if (cover) chrome = cover;
        else continue;
      }
    } else if (!shown(el)) {
      continue;
    }
    if (role !== "combobox") {
      var host = el.closest && el.closest("[role='combobox']");
      if (host && host !== el) continue;
    }
    if (!chrome) chrome = fieldChrome(el);
    if (!chrome || !shown(chrome)) continue;
    var already = false;
    var k;
    for (k = 0; k < seenChrome.length; k++) {
      if (seenChrome[k] === chrome) already = true;
    }
    if (already) continue;
    seenChrome.push(chrome);
    var cr = chrome.getBoundingClientRect();
    var lab = labelFor(el);
    var lr = lab ? lab.getBoundingClientRect() : cr;
    var hOverlap = Math.min(lr.right, cr.right) - Math.max(lr.left, cr.left);
    var vOverlap = Math.min(lr.bottom, cr.bottom) - Math.max(lr.top, cr.top);
    var stacked = Boolean(lab) && hOverlap > 8 && lr.bottom <= cr.top + 8;
    var side = Boolean(lab) && lr.right <= cr.left + 12 && vOverlap > 4;
    var item = {
      name: fieldName(el, lab),
      controlLeft: cr.left,
      controlRight: cr.right,
      controlTop: cr.top,
      controlBottom: cr.bottom,
      controlHeight: cr.height,
      labelTop: lr.top,
      labelBottom: lr.bottom,
      labelLeft: lr.left,
      labelRight: lr.right,
      stacked: stacked,
      side: side,
      pane: pane,
      cardKey: cardKeyFor(el),
      wrap: wrapFor(el),
    };
    var lit = lab ? firstLineTop(lab) : undefined;
    if (typeof lit === "number" && isFinite(lit)) item.labelInkTop = lit;
    var vit;
    if (tag === "input" || tag === "textarea") vit = contentInkTop(el);
    else vit = firstLineTop(chrome);
    if (typeof vit !== "number" || !isFinite(vit)) vit = contentInkTop(chrome);
    if (typeof vit === "number" && isFinite(vit)) item.valueInkTop = vit;
    fields.push(item);
  }
  return fields;
})()`;

export async function scanFormScanline(page: Page): Promise<QualityIssue[]> {
  const raw = (await page.evaluate(COLLECT_SRC).catch(() => [])) as FormFieldSample[];
  if (!Array.isArray(raw)) return [];
  const fields: FormFieldSample[] = [];
  for (const f of raw) {
    if (!f || typeof f.controlTop !== "number") continue;
    fields.push(f);
  }
  return formScanlineIssues(fields);
}
