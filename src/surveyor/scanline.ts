import type { Page } from "playwright";
import type { QualityIssue } from "../schema/quality.js";
import { SPARSE_MIN_PANE, sparseLayoutIssue, type SparseSample } from "./sparse.js";

export type LayoutHit = {
  rule: "clip" | "scanline";
  where: string;
  message: string;
  confidence: "high" | "medium";
};

const MAX_HITS = 8;
const CLIP_PX = 4;
const SCAN_PX = 16;

/**
 * Browser-side. Source string so tsx/esbuild `__name` helpers are not
 * serialized into the page.
 */
const COLLECT_SRC = `(() => {
  var CLIP_PX = ${CLIP_PX};
  var SCAN_PX = ${SCAN_PX};
  var MAX_HITS = ${MAX_HITS};
  var hits = [];
  var seen = {};

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

  function clipText(s, n) {
    var one = String(s || "").replace(/\\s+/g, " ").trim();
    if (!one) return "";
    return one.length <= n ? one : one.slice(0, n - 1) + "…";
  }

  function push(rule, where, message, confidence) {
    var key = rule + "\\0" + where + "\\0" + message;
    if (seen[key]) return;
    seen[key] = true;
    hits.push({ rule: rule, where: where, message: message, confidence: confidence });
  }

  function cleanEllipsis(el) {
    var cs = window.getComputedStyle(el);
    if (cs.textOverflow === "ellipsis") return true;
    var clamp = cs.webkitLineClamp || cs.lineClamp;
    if (clamp && clamp !== "none") return true;
    return false;
  }

  function scrolledOverflow(el) {
    var cs = window.getComputedStyle(el);
    var ox = cs.overflowX;
    return ox === "auto" || ox === "scroll";
  }

  function isClipped(el) {
    if (el.scrollWidth <= el.clientWidth + CLIP_PX) return false;
    if (cleanEllipsis(el)) return false;
    if (scrolledOverflow(el)) return false;
    var text = (el.innerText || el.value || "").replace(/\\s+/g, " ").trim();
    return text.length >= 2;
  }

  function overflowAmt(el) {
    return el.scrollWidth - el.clientWidth;
  }

  function colLabel(table, i) {
    var head = table.querySelector("thead");
    var cells = head
      ? head.querySelectorAll("th, [role='columnheader']")
      : table.querySelectorAll("tr:first-child > th, [role='row']:first-child > [role='columnheader']");
    var cell = cells[i];
    var name = cell ? clipText(cell.innerText, 32) : "";
    return name || "column " + (i + 1);
  }

  function tableWhere(table) {
    var cap = table.querySelector("caption");
    if (cap && cap.innerText) return clipText(cap.innerText, 40);
    var labelled = table.getAttribute("aria-label");
    if (labelled && labelled.trim()) return clipText(labelled, 40);
    var testid = table.getAttribute("data-testid");
    if (testid && testid.trim()) return clipText(testid, 40);
    return "table";
  }

  function rowCells(row) {
    var direct = row.querySelectorAll(":scope > td, :scope > th, :scope > [role='cell'], :scope > [role='gridcell'], :scope > [role='columnheader'], :scope > [role='rowheader']");
    if (direct.length > 0) return direct;
    return row.querySelectorAll("td, th, [role='cell'], [role='gridcell']");
  }

  function bodyRows(table) {
    var bodies = table.querySelectorAll("tbody");
    var rows = [];
    var list;
    if (bodies.length > 0) {
      list = table.querySelectorAll("tbody tr, tbody [role='row']");
    } else {
      list = table.querySelectorAll("tr, [role='row']");
    }
    var i;
    for (i = 0; i < list.length; i++) {
      var row = list[i];
      if (row.closest("thead") || row.closest("tfoot")) continue;
      if (row.querySelector("th") && !row.querySelector("td")) continue;
      if (!shown(row)) continue;
      var cells = rowCells(row);
      if (cells.length < 2) continue;
      rows.push({ row: row, cells: cells });
    }
    return rows;
  }

  function scanTable(table) {
    if (!shown(table)) return;
    var rows = bodyRows(table);
    if (rows.length === 0) return;
    var whereTable = tableWhere(table);
    var r, c, cell;
    for (r = 0; r < rows.length; r++) {
      for (c = 0; c < rows[r].cells.length; c++) {
        cell = rows[r].cells[c];
        if (!shown(cell)) continue;
        if (!isClipped(cell)) continue;
        var amt = overflowAmt(cell);
        var label = colLabel(table, c);
        push(
          "clip",
          label + " in " + whereTable,
          label + " text is cut mid-word without an ellipsis",
          amt >= 12 ? "high" : "medium",
        );
        if (hits.length >= MAX_HITS) return;
      }
    }
    if (rows.length < 2) return;
    var spanned = false;
    for (r = 0; r < rows.length; r++) {
      for (c = 0; c < rows[r].cells.length; c++) {
        cell = rows[r].cells[c];
        if ((cell.colSpan || 1) > 1 || (cell.rowSpan || 1) > 1) spanned = true;
      }
    }
    if (spanned) return;
    var colCount = 0;
    for (r = 0; r < rows.length; r++) {
      if (rows[r].cells.length > colCount) colCount = rows[r].cells.length;
    }
    for (c = 0; c < colCount; c++) {
      var lefts = [];
      for (r = 0; r < rows.length; r++) {
        cell = rows[r].cells[c];
        if (!cell || !shown(cell)) continue;
        var box = cell.getBoundingClientRect();
        var cs = window.getComputedStyle(cell);
        lefts.push(box.left + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0));
      }
      if (lefts.length < 2) continue;
      var minL = lefts[0];
      var maxL = lefts[0];
      var i;
      for (i = 1; i < lefts.length; i++) {
        if (lefts[i] < minL) minL = lefts[i];
        if (lefts[i] > maxL) maxL = lefts[i];
      }
      var spread = maxL - minL;
      if (spread <= SCAN_PX) continue;
      var label = colLabel(table, c);
      push(
        "scanline",
        label + " in " + whereTable,
        label + " cells do not share a left edge",
        spread >= 28 ? "high" : "medium",
      );
      if (hits.length >= MAX_HITS) return;
    }
  }

  var tables = document.querySelectorAll("table, [role='table'], [role='grid']");
  var t;
  for (t = 0; t < tables.length; t++) {
    scanTable(tables[t]);
    if (hits.length >= MAX_HITS) break;
  }

  if (hits.length < MAX_HITS) {
    var fields = document.querySelectorAll(
      "input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='button']):not([type='submit']):not([type='file']), textarea",
    );
    var f;
    for (f = 0; f < fields.length; f++) {
      var el = fields[f];
      if (!shown(el)) continue;
      if (!isClipped(el)) continue;
      var amt = overflowAmt(el);
      var name =
        clipText(el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("name") || el.getAttribute("data-testid") || "", 32) ||
        "field";
      push(
        "clip",
        name,
        "Value is cut off inside the field (no ellipsis)",
        amt >= 12 ? "high" : "medium",
      );
      if (hits.length >= MAX_HITS) break;
    }
  }

  return hits;
})()`;

/**
 * Browser-side. Main-pane boxes for left-locked empty-right (sparse).
 * Source string so tsx/esbuild `__name` helpers are not serialized into the page.
 */
const SPARSE_SRC = `(() => {
  var MIN_PANE = ${SPARSE_MIN_PANE};
  var vw = window.innerWidth || 0;
  var vh = window.innerHeight || 0;
  if (vw < MIN_PANE) return null;

  function shown(el) {
    if (!el) return false;
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    }
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    if (r.bottom <= 0 || r.right <= 0) return false;
    if (r.top >= vh || r.left >= vw) return false;
    return true;
  }

  function inChrome(el) {
    return Boolean(
      el.closest(
        "nav, aside, header, footer, [role='navigation'], [role='banner'], [role='complementary'], [role='contentinfo']",
      ),
    );
  }

  function openDialog() {
    var nodes = document.querySelectorAll("dialog[open], [role='dialog']");
    var i;
    for (i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.getAttribute("aria-hidden") === "true") continue;
      if (!shown(el)) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 80) continue;
      return { el: el, box: r };
    }
    return null;
  }

  function sidebarRight() {
    var nodes = document.querySelectorAll("nav, aside, [role='navigation'], [role='complementary']");
    var right = 0;
    var i;
    for (i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!shown(el)) continue;
      var r = el.getBoundingClientRect();
      if (r.left > 48) continue;
      if (r.height < vh * 0.4) continue;
      if (r.width > vw * 0.4) continue;
      if (r.right > right) right = r.right;
    }
    return right;
  }

  var dlg = openDialog();
  if (dlg && dlg.box.width < vw * 0.7) return null;

  var paneEl = dlg ? dlg.el : document.querySelector("main, [role='main']");
  var pane;
  if (paneEl && shown(paneEl)) {
    pane = paneEl.getBoundingClientRect();
  } else {
    var left = sidebarRight();
    pane = { left: left, right: vw, top: 0, bottom: vh, width: vw - left, height: vh };
  }
  if (pane.right - pane.left < MIN_PANE) return null;

  function clipText(s, n) {
    var one = String(s || "").replace(/\\s+/g, " ").trim();
    if (!one) return "";
    return one.length <= n ? one : one.slice(0, n - 1) + "…";
  }

  function fieldCount(root) {
    return root.querySelectorAll(
      "input:not([type='hidden']):not([type='button']):not([type='submit']):not([type='file']), textarea, select",
    ).length;
  }

  var boxes = [];
  var where = "";
  var h1 = paneEl && paneEl.querySelector ? paneEl.querySelector("h1, h2, [role='heading']") : null;
  if (h1 && h1.innerText) where = clipText(h1.innerText, 40);

  var forms = (paneEl || document).querySelectorAll("form");
  var f;
  for (f = 0; f < forms.length; f++) {
    var form = forms[f];
    if (inChrome(form) || !shown(form)) continue;
    if (fieldCount(form) < 3) continue;
    var fr = form.getBoundingClientRect();
    boxes.push({ left: fr.left, right: fr.right, top: fr.top, bottom: fr.bottom });
    if (!where) {
      var labelled = form.getAttribute("aria-label") || form.getAttribute("name");
      if (labelled) where = clipText(labelled, 40);
    }
  }

  var tables = (paneEl || document).querySelectorAll("table, [role='table'], [role='grid']");
  var t;
  for (t = 0; t < tables.length; t++) {
    var table = tables[t];
    if (inChrome(table) || !shown(table)) continue;
    var tr = table.getBoundingClientRect();
    boxes.push({ left: tr.left, right: tr.right, top: tr.top, bottom: tr.bottom });
  }

  if (boxes.length === 0) {
    var fields = (paneEl || document).querySelectorAll(
      "input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='button']):not([type='submit']):not([type='file']), textarea, select",
    );
    var i;
    var n = 0;
    var minL = Infinity;
    var maxR = -Infinity;
    var minT = Infinity;
    var maxB = -Infinity;
    for (i = 0; i < fields.length; i++) {
      var el = fields[i];
      if (inChrome(el) || !shown(el)) continue;
      var r = el.getBoundingClientRect();
      minL = Math.min(minL, r.left);
      maxR = Math.max(maxR, r.right);
      minT = Math.min(minT, r.top);
      maxB = Math.max(maxB, r.bottom);
      n += 1;
    }
    if (n >= 3 && maxR > minL) {
      boxes.push({ left: minL, right: maxR, top: minT, bottom: maxB });
    }
  }

  if (boxes.length === 0) return null;
  return {
    pane: { left: pane.left, right: pane.right },
    boxes: boxes,
    where: where || "main pane",
  };
})()`;

export async function scanTableLayout(page: Page): Promise<QualityIssue[]> {
  const hits = (await page.evaluate(COLLECT_SRC).catch(() => [])) as LayoutHit[];
  const issues: QualityIssue[] = [];
  if (Array.isArray(hits)) {
    for (const hit of hits) {
      if (hit.rule !== "clip" && hit.rule !== "scanline") continue;
      if (!hit.message || !hit.where) continue;
      issues.push({
        source: "visual",
        rule: hit.rule,
        severity: hit.rule === "clip" ? "error" : "warning",
        message: hit.message,
        count: 1,
        confidence: hit.confidence === "high" ? "high" : "medium",
        where: hit.where,
      });
    }
  }
  const sample = (await page.evaluate(SPARSE_SRC).catch(() => null)) as SparseSample | null;
  const sparse = sparseLayoutIssue(sample);
  if (sparse) issues.push(sparse);
  return issues;
}
