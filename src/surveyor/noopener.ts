import type { Page } from "playwright";
import type { QualityIssue } from "../schema/quality.js";

/** Tabnabbing: a `_blank` window can rewrite `window.opener`. */
export const MAX_NOOPENER_HITS = 8;

export type NoopenerHit = {
  where: string;
  rel?: string;
};

/** True when `rel` already has `noopener` or `noreferrer` (either is a pass). */
export function relHasNoopener(rel: string): boolean {
  const tokens = String(rel ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  return tokens.some((t) => t === "noopener" || t === "noreferrer");
}

export function noopenerIssue(hit: NoopenerHit): QualityIssue | undefined {
  if (!hit || typeof hit.where !== "string") return undefined;
  const where = hit.where.replace(/\s+/g, " ").trim();
  if (!where) return undefined;
  if (relHasNoopener(String(hit.rel ?? ""))) return undefined;
  return {
    source: "visual",
    rule: "noopener",
    severity: "warning",
    confidence: "high",
    count: 1,
    where,
    message: `Link opens a new tab without rel="noopener"`,
  };
}

function issuesFromHits(hits: NoopenerHit[]): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(hits)) return issues;
  for (const hit of hits) {
    const issue = noopenerIssue(hit);
    if (!issue) continue;
    const key = issue.where ?? "";
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
    if (issues.length >= MAX_NOOPENER_HITS) break;
  }
  return issues;
}

/**
 * Browser-side. Source string so tsx/esbuild `__name` helpers are not
 * serialized into the page.
 */
const COLLECT_SRC = `(() => {
  var MAX_HITS = ${MAX_NOOPENER_HITS};
  var hits = [];
  var seen = {};

  function clip(s, n) {
    var one = String(s || "").replace(/\\s+/g, " ").trim();
    if (!one) return "";
    return one.length <= n ? one : one.slice(0, n - 1) + "…";
  }

  function generatedId(id) {
    if (!id) return true;
    if (id.charAt(0) === ":") return true;
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) return true;
    return false;
  }

  function shown(el) {
    if (!el) return false;
    if (el.closest && el.closest("[inert]")) return false;
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return false;
    if (el.closest && el.closest("[aria-hidden='true']")) return false;
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    }
    var cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (parseFloat(cs.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (r.bottom <= 0 || r.right <= 0) return false;
    return true;
  }

  function relOk(rel) {
    var parts = String(rel || "").toLowerCase().split(/\\s+/);
    var i;
    for (i = 0; i < parts.length; i++) {
      if (parts[i] === "noopener" || parts[i] === "noreferrer") return true;
    }
    return false;
  }

  function describeWhere(el) {
    var tag = el.tagName.toLowerCase();
    var hooks = ["data-testid", "data-test-id", "data-test", "data-cy"];
    var i;
    for (i = 0; i < hooks.length; i++) {
      var hook = el.getAttribute(hooks[i]);
      if (hook && hook.trim()) return tag + "[" + hooks[i] + '="' + clip(hook.trim(), 40) + '"]';
    }
    var id = el.id && String(el.id).trim();
    if (id && !generatedId(id)) return "#" + clip(id, 40);
    var href = el.getAttribute("href");
    if (href && href.trim()) return tag + '[href="' + clip(href.trim(), 48) + '"]';
    return tag;
  }

  var baseEl = document.querySelector("base");
  var baseTarget = baseEl ? String(baseEl.getAttribute("target") || "").trim().toLowerCase() : "";
  var nodes = document.querySelectorAll("a, area");
  var n;
  for (n = 0; n < nodes.length; n++) {
    var el = nodes[n];
    var targetAttr = el.getAttribute("target");
    var target = targetAttr != null && String(targetAttr).trim()
      ? String(targetAttr).trim().toLowerCase()
      : baseTarget;
    if (target !== "_blank") continue;
    if (!shown(el)) continue;
    var rel = el.getAttribute("rel") || "";
    if (relOk(rel)) continue;
    var where = describeWhere(el);
    if (!where || seen[where]) continue;
    seen[where] = true;
    hits.push({ where: where, rel: rel });
    if (hits.length >= MAX_HITS) break;
  }
  return hits;
})()`;

export async function scanNoopener(page: Page): Promise<QualityIssue[]> {
  const hits = (await page.evaluate(COLLECT_SRC).catch(() => [])) as NoopenerHit[];
  if (!Array.isArray(hits)) return [];
  return issuesFromHits(hits);
}
