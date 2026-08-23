import type { Page } from "playwright";
import type { QualityIssue } from "../schema/quality.js";

/** Cap so one page of placeholders does not flood the ledger. */
export const BROKEN_MAX = 8;
/** Displayed size at or above this is a real hole, not a decorative chip. */
export const BROKEN_HIGH_PX = 32;

export type BrokenImageRecord = {
  complete: boolean;
  naturalWidth: number;
  src: string;
  alt: string;
  testid: string;
  width: number;
  height: number;
  display: string;
  visible: boolean;
  ariaHidden: boolean;
  inMain: boolean;
};

/**
 * Browser-side. Source string so tsx/esbuild `__name` helpers are not
 * serialized into the page.
 */
const COLLECT_SRC = `(() => {
  var nodes = document.querySelectorAll("img, image");
  var out = [];
  var i;

  function shown(el) {
    if (!el) return false;
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    } else {
      var cs = window.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
    }
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    if (r.bottom <= 0 || r.right <= 0) return false;
    if (r.top >= (window.innerHeight || 0) || r.left >= (window.innerWidth || 0)) return false;
    return true;
  }

  function srcOf(el) {
    var src = el.getAttribute("src");
    if (src != null) return String(src);
    var href = el.getAttribute("href");
    if (href != null && href !== "") return String(href);
    try {
      var ns = el.getAttributeNS("http://www.w3.org/1999/xlink", "href");
      if (ns) return String(ns);
    } catch (e) {}
    if (el.href && typeof el.href.baseVal === "string") return el.href.baseVal;
    return "";
  }

  function testidOf(el) {
    return (
      el.getAttribute("data-testid") ||
      el.getAttribute("data-test-id") ||
      el.getAttribute("data-test") ||
      el.getAttribute("data-cy") ||
      ""
    );
  }

  for (i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var r = el.getBoundingClientRect();
    var cs = window.getComputedStyle(el);
    out.push({
      complete: typeof el.complete === "boolean" ? el.complete : false,
      naturalWidth: typeof el.naturalWidth === "number" ? el.naturalWidth : -1,
      src: srcOf(el),
      alt: el.getAttribute("alt") ? String(el.getAttribute("alt")) : "",
      testid: String(testidOf(el) || ""),
      width: r.width,
      height: r.height,
      display: cs.display,
      visible: shown(el),
      ariaHidden: el.getAttribute("aria-hidden") === "true",
      inMain: Boolean(el.closest("main, [role='main']")),
    });
  }
  return out;
})()`;

function clip(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  if (!one) return "";
  return one.length <= n ? one : `${one.slice(0, n - 1)}…`;
}

/** Basename of a http(s)/relative src. Empty for `data:` and blanks. */
export function brokenFilename(src: string): string {
  const s = src.trim();
  if (!s || /^data:/i.test(s)) return "";
  try {
    const u = new URL(s, "http://local.invalid/");
    const base = u.pathname.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(base);
  } catch {
    const noQuery = s.split("?")[0] ?? s;
    const parts = noQuery.split("/");
    return parts[parts.length - 1] ?? "";
  }
}

export function brokenWhere(rec: Pick<BrokenImageRecord, "alt" | "testid" | "src">): string {
  const alt = clip(rec.alt, 40);
  if (alt) return alt;
  const testid = clip(rec.testid, 40);
  if (testid) return testid;
  const name = clip(brokenFilename(rec.src), 40);
  if (name) return name;
  return "image";
}

export function brokenMessage(alt: string): string {
  const a = clip(alt, 40);
  return a ? `Image failed to decode (${a})` : "Image failed to decode";
}

export function brokenConfidence(rec: Pick<BrokenImageRecord, "inMain" | "width" | "height">): "high" | "medium" {
  if (rec.inMain) return "high";
  if (rec.width >= BROKEN_HIGH_PX || rec.height >= BROKEN_HIGH_PX) return "high";
  return "medium";
}

/** Failed decode with a real src. Skips hidden, empty, loading, and `data:` stubs. */
export function brokenLayoutIssue(rec: BrokenImageRecord): QualityIssue | undefined {
  if (!rec.visible) return undefined;
  if (rec.display === "none") return undefined;
  if (!(rec.width > 0) || !(rec.height > 0)) return undefined;
  if (rec.ariaHidden) return undefined;
  if (rec.complete !== true) return undefined;
  if (rec.naturalWidth !== 0) return undefined;
  const src = rec.src.trim();
  if (!src) return undefined;
  if (/^data:/i.test(src)) return undefined;
  return {
    source: "visual",
    rule: "broken",
    severity: "error",
    message: brokenMessage(rec.alt),
    count: 1,
    confidence: brokenConfidence(rec),
    where: brokenWhere(rec),
  };
}

export function brokenIssuesFrom(records: readonly BrokenImageRecord[]): QualityIssue[] {
  const out: QualityIssue[] = [];
  const seen = new Set<string>();
  for (const rec of records) {
    const issue = brokenLayoutIssue(rec);
    if (!issue) continue;
    const key = `${issue.where}\0${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
    if (out.length >= BROKEN_MAX) break;
  }
  return out;
}

export async function scanBroken(page: Page): Promise<QualityIssue[]> {
  const records = (await page.evaluate(COLLECT_SRC).catch(() => [])) as BrokenImageRecord[];
  if (!Array.isArray(records)) return [];
  return brokenIssuesFrom(records);
}
