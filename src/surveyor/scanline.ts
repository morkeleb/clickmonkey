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
export const CLIP_PX = 4;
const SCAN_PX = 16;
/** Visible inner boxes to check when the td itself does not overflow. */
export const INNER_CLIP_CAP = 8;

export function isClippedBox(opts: {
  scrollWidth: number;
  clientWidth: number;
  textOverflow?: string;
  overflowX?: string;
  webkitLineClamp?: string;
  lineClamp?: string;
  text?: string;
}): boolean {
  if (opts.scrollWidth <= opts.clientWidth + CLIP_PX) return false;
  if ((opts.textOverflow || "") === "ellipsis") return false;
  const clamp = opts.webkitLineClamp || opts.lineClamp;
  if (clamp && clamp !== "none") return false;
  const ox = opts.overflowX || "";
  if (ox === "auto" || ox === "scroll") return false;
  const text = String(opts.text || "").replace(/\s+/g, " ").trim();
  return text.length >= 2;
}

/**
 * Browser-side. Source string so tsx/esbuild `__name` helpers are not
 * serialized into the page.
 */
const COLLECT_SRC = `(() => {
  var CLIP_PX = ${CLIP_PX};
  var SCAN_PX = ${SCAN_PX};
  var MAX_HITS = ${MAX_HITS};
  var INNER_CLIP_CAP = ${INNER_CLIP_CAP};
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

  var clipN = 0;
  var lineN = 0;

  function push(rule, where, message, confidence) {
    if (rule === "clip" && clipN >= MAX_HITS) return;
    if (rule === "scanline" && lineN >= MAX_HITS) return;
    var key = rule + "\\0" + where + "\\0" + message;
    if (seen[key]) return;
    seen[key] = true;
    hits.push({ rule: rule, where: where, message: message, confidence: confidence });
    if (rule === "clip") clipN += 1;
    else if (rule === "scanline") lineN += 1;
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

  function nestedInOtherCell(inner, cell) {
    var host = inner.closest("td, th, [role='cell'], [role='gridcell']");
    return Boolean(host && host !== cell);
  }

  function editorEl(el) {
    if (!el) return false;
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea") return true;
    var role = ((el.getAttribute && el.getAttribute("role")) || "").toLowerCase();
    return (
      role === "combobox" ||
      role === "textbox" ||
      role === "searchbox" ||
      role === "spinbutton" ||
      role === "listbox" ||
      role === "option"
    );
  }

  function inEditor(el, cell) {
    var cur = el;
    while (cur && cur !== cell) {
      if (editorEl(cur)) return true;
      cur = cur.parentElement;
    }
    return editorEl(el);
  }

  function cellIsEditor(cell) {
    if (editorEl(cell)) return true;
    var nodes = cell.querySelectorAll(
      "input, select, textarea, [role='combobox'], [role='textbox'], [role='searchbox'], [role='spinbutton']",
    );
    var i;
    for (i = 0; i < nodes.length; i++) {
      if (nestedInOtherCell(nodes[i], cell)) continue;
      if (shown(nodes[i])) return true;
    }
    return false;
  }

  // Inner span/div can clip while the td box itself does not overflow.
  // Skip the cell's editor — input overflow is field clip, not mid-word cell clip.
  function cellClipAmt(cell) {
    if (isClipped(cell) && !cellIsEditor(cell)) return overflowAmt(cell);
    var nodes = cell.querySelectorAll("*");
    var i;
    var n = 0;
    for (i = 0; i < nodes.length && n < INNER_CLIP_CAP; i++) {
      var inner = nodes[i];
      var tag = (inner.tagName || "").toLowerCase();
      if (tag === "td" || tag === "th") continue;
      var role = ((inner.getAttribute && inner.getAttribute("role")) || "").toLowerCase();
      if (role === "cell" || role === "gridcell" || role === "columnheader" || role === "rowheader") continue;
      if (nestedInOtherCell(inner, cell)) continue;
      if (inEditor(inner, cell)) continue;
      if (!shown(inner)) continue;
      n += 1;
      if (!isClipped(inner)) continue;
      return overflowAmt(inner);
    }
    return 0;
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
      if (row.querySelector("[role='columnheader']") && !row.querySelector("[role='gridcell'], td")) continue;
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
        var amt = cellClipAmt(cell);
        if (!amt) continue;
        var label = colLabel(table, c);
        push(
          "clip",
          label + " in " + whereTable,
          "Text in the " + label + " column is cut off (no ellipsis)",
          amt >= 12 ? "high" : "medium",
        );
        if (clipN >= MAX_HITS) break;
      }
      if (clipN >= MAX_HITS) break;
    }
    if (lineN >= MAX_HITS) return;
    var colCount = 0;
    for (r = 0; r < rows.length; r++) {
      if (rows[r].cells.length > colCount) colCount = rows[r].cells.length;
    }
    function contentLeft(el) {
      var box = el.getBoundingClientRect();
      var cs = window.getComputedStyle(el);
      return box.left + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.borderLeftWidth) || 0);
    }
    function textAlignEdge(el) {
      var cs = window.getComputedStyle(el);
      var a = (cs.textAlign || "").toLowerCase();
      var dir = (cs.direction || "").toLowerCase();
      if (a === "center") return "center";
      if (a === "right" || a === "end") return "right";
      if (a === "left" || a === "start") return "left";
      return dir === "rtl" ? "right" : "left";
    }
    function firstLineRect(el) {
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
        return line;
      }
      return null;
    }
    function inkRects(el) {
      var out = [];
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      var node;
      while ((node = walker.nextNode())) {
        var raw = node.nodeValue || "";
        if (!raw.replace(/\\s+/g, "")) continue;
        var range = document.createRange();
        try { range.selectNodeContents(node); } catch (err) { continue; }
        var rects = range.getClientRects();
        var k;
        for (k = 0; k < rects.length; k++) {
          var line = rects[k];
          if (line.width < 1 || line.height < 1) continue;
          out.push({ left: line.left, right: line.right, top: line.top, bottom: line.bottom });
        }
      }
      return out;
    }
    function inkOverlapAmt(aRects, bRects) {
      var best = 0;
      var i, j;
      for (i = 0; i < aRects.length; i++) {
        for (j = 0; j < bRects.length; j++) {
          var w = Math.min(aRects[i].right, bRects[j].right) - Math.max(aRects[i].left, bRects[j].left);
          var h = Math.min(aRects[i].bottom, bRects[j].bottom) - Math.max(aRects[i].top, bRects[j].top);
          if (w >= 8 && h >= 4) {
            var m = w < h ? w : h;
            if (m > best) best = m;
          }
        }
      }
      return best;
    }
    function paintsIntoNext(aRects, nextEl) {
      if (aRects.length === 0) return 0;
      var nextBox = nextEl.getBoundingClientRect();
      var left = contentLeft(nextEl);
      var right = -Infinity;
      var i;
      for (i = 0; i < aRects.length; i++) {
        if (aRects[i].right > right) right = aRects[i].right;
      }
      var extra = right - left;
      if (extra < 8) return 0;
      for (i = 0; i < aRects.length; i++) {
        var h = Math.min(aRects[i].bottom, nextBox.bottom) - Math.max(aRects[i].top, nextBox.top);
        if (h >= 4) return extra;
      }
      return 0;
    }
    function textEdge(el, edge) {
      var line = firstLineRect(el);
      if (!line) return edge === "right" ? el.getBoundingClientRect().right : contentLeft(el);
      return edge === "right" ? line.right : line.left;
    }
    function spreadOf(vals) {
      if (vals.length === 0) return 0;
      var minV = vals[0];
      var maxV = vals[0];
      var s;
      for (s = 1; s < vals.length; s++) {
        if (vals[s] < minV) minV = vals[s];
        if (vals[s] > maxV) maxV = vals[s];
      }
      return maxV - minV;
    }
    function columnMostlyEditors(col) {
      var n = 0;
      var editors = 0;
      var i;
      for (i = 0; i < rows.length; i++) {
        var box = rows[i].cells[col];
        if (!box || !shown(box)) continue;
        n += 1;
        if (cellIsEditor(box)) editors += 1;
      }
      return n > 0 && editors * 2 >= n;
    }
    if (rows.length >= 2) {
      for (c = 0; c < colCount; c++) {
        if (columnMostlyEditors(c)) continue;
        var lefts = [];
        for (r = 0; r < rows.length; r++) {
          cell = rows[r].cells[c];
          if (!cell || !shown(cell)) continue;
          if ((cell.colSpan || 1) > 1 || (cell.rowSpan || 1) > 1) continue;
          lefts.push(contentLeft(cell));
        }
        if (lefts.length < 2) continue;
        var spread = spreadOf(lefts);
        if (spread <= SCAN_PX) continue;
        var label = colLabel(table, c);
        push(
          "scanline",
          label + " in " + whereTable,
          "The " + label + " column does not line up from row to row",
          spread >= 28 ? "high" : "medium",
        );
        if (lineN >= MAX_HITS) return;
      }
    }
    var head = table.querySelector("thead tr");
    if (!head) {
      var grole = table.querySelectorAll("[role='row']");
      var g;
      for (g = 0; g < grole.length; g++) {
        if (grole[g].querySelector("[role='columnheader']") && !grole[g].querySelector("[role='gridcell'], td")) {
          head = grole[g];
          break;
        }
      }
    }
    var heads = head && shown(head) ? rowCells(head) : [];
    if (clipN < MAX_HITS && heads.length >= 2) {
      var collided = {};
      var squishNames = [];
      var squishAmt = 0;
      for (c = 0; c < heads.length - 1; c++) {
        if (!heads[c] || !shown(heads[c]) || !heads[c + 1] || !shown(heads[c + 1])) continue;
        if ((heads[c].colSpan || 1) > 1 || (heads[c + 1].colSpan || 1) > 1) continue;
        var aInk = inkRects(heads[c]);
        var bInk = inkRects(heads[c + 1]);
        if (aInk.length === 0 || bInk.length === 0) continue;
        var hit = inkOverlapAmt(aInk, bInk);
        var into = paintsIntoNext(aInk, heads[c + 1]);
        if (into > hit) hit = into;
        var ar = heads[c].getBoundingClientRect();
        var br = heads[c + 1].getBoundingClientRect();
        var bw = Math.min(ar.right, br.right) - Math.max(ar.left, br.left);
        var bh = Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top);
        if (bw >= 8 && bh >= 8 && bw > hit) hit = bw;
        if (hit < 8) continue;
        if (hit > squishAmt) squishAmt = hit;
        if (!collided[c]) {
          collided[c] = true;
          squishNames.push(colLabel(table, c));
        }
        if (!collided[c + 1]) {
          collided[c + 1] = true;
          squishNames.push(colLabel(table, c + 1));
        }
      }
      if (squishNames.length >= 2) {
        var squishLabel =
          squishNames.length === 2
            ? squishNames[0] + " and " + squishNames[1]
            : squishNames.slice(0, squishNames.length - 1).join(", ") + ", and " + squishNames[squishNames.length - 1];
        push(
          "clip",
          squishNames.join(" · ") + " in " + whereTable,
          squishLabel + " headers are squished together",
          squishAmt >= 16 ? "high" : "medium",
        );
      }
      for (c = 0; c < heads.length; c++) {
        if (collided[c]) continue;
        if (!heads[c] || !shown(heads[c])) continue;
        var headAmt = cellClipAmt(heads[c]);
        if (!headAmt) continue;
        var headLabel = colLabel(table, c);
        push(
          "clip",
          headLabel + " in " + whereTable,
          "The " + headLabel + " header is cut off — the title does not fit its column",
          headAmt >= 12 ? "high" : "medium",
        );
        if (clipN >= MAX_HITS) break;
      }
    }
    for (c = 0; c < Math.max(colCount, heads.length); c++) {
      if (!heads[c] || !shown(heads[c])) continue;
      if ((heads[c].colSpan || 1) > 1) continue;
      if (columnMostlyEditors(c)) continue;
      var hLeft = contentLeft(heads[c]);
      var cellLefts = [];
      var hAlign = textAlignEdge(heads[c]);
      var alignOk = hAlign === "left" || hAlign === "right";
      var cellInk = [];
      for (r = 0; r < rows.length; r++) {
        cell = rows[r].cells[c];
        if (!cell || !shown(cell)) continue;
        if ((cell.colSpan || 1) > 1 || (cell.rowSpan || 1) > 1) continue;
        cellLefts.push(contentLeft(cell));
        if (alignOk && textAlignEdge(cell) !== hAlign) alignOk = false;
        if (hAlign === "left" || hAlign === "right") cellInk.push(textEdge(cell, hAlign));
      }
      if (cellLefts.length === 0) continue;
      var all = [hLeft].concat(cellLefts);
      var hSpread = spreadOf(all);
      if (hSpread <= SCAN_PX && alignOk && cellInk.length > 0) {
        var inkSpread = spreadOf([textEdge(heads[c], hAlign)].concat(cellInk));
        if (inkSpread > SCAN_PX && hAlign === "left") {
          var locked = 0;
          for (r = 0; r < rows.length; r++) {
            cell = rows[r].cells[c];
            if (!cell || !shown(cell)) continue;
            if ((cell.colSpan || 1) > 1 || (cell.rowSpan || 1) > 1) continue;
            var line = firstLineRect(cell);
            var box = cell.getBoundingClientRect();
            if (line && line.left >= (box.left + box.right) / 2) locked += 1;
          }
          if (locked * 2 >= cellInk.length) inkSpread = 0;
        }
        hSpread = inkSpread;
      }
      if (hSpread <= SCAN_PX) continue;
      var hLabel = colLabel(table, c);
      push(
        "scanline",
        hLabel + " in " + whereTable,
        "The " + hLabel + " header does not line up with the cells below it",
        hSpread >= 28 ? "high" : "medium",
      );
      if (lineN >= MAX_HITS) return;
    }
  }

  var tables = document.querySelectorAll("table, [role='table'], [role='grid']");
  var t;
  for (t = 0; t < tables.length; t++) {
    scanTable(tables[t]);
    if (clipN >= MAX_HITS && lineN >= MAX_HITS) break;
  }

  if (clipN < MAX_HITS) {
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
      if (clipN >= MAX_HITS) break;
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
