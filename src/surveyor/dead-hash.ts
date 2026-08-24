import type { Page } from "playwright";
import type { QualityIssue } from "../schema/quality.js";

/** Cap so one nav of dummy in-page hashes does not flood the ledger. */
export const MAX_DEAD_HASH_HITS = 8;

export type DeadHashHit = {
  hash: string;
  where: string;
};

function clip(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  if (!one) return "";
  return one.length <= n ? one : `${one.slice(0, n - 1)}…`;
}

/** `#foo%20bar` → `foo bar`. Malformed % sequences keep the raw fragment. */
export function decodeHashFragment(raw: string): string {
  const s = String(raw ?? "");
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Not an element-id jump: empty `#`, `#top`, `javascript:`, and SPA hash
 * state (`#/route`, `#!/app`, `#tab=x`). A missing `#section` is still a hit.
 */
export function skipDeadHashHref(href: string): boolean {
  const raw = String(href ?? "").trim();
  if (!raw) return true;
  if (/^javascript:/i.test(raw)) return true;
  const hashAt = raw.indexOf("#");
  const fragRaw = hashAt >= 0 ? raw.slice(hashAt + 1) : raw;
  const frag = decodeHashFragment(fragRaw).trim();
  if (!frag) return true;
  if (/^javascript:/i.test(frag)) return true;
  if (frag.toLowerCase() === "top") return true;
  if (frag.startsWith("/") || frag.startsWith("!")) return true;
  if (/[/?&=]/.test(frag)) return true;
  return false;
}

export function deadHashMessage(hash: string): string {
  const raw = String(hash || "").replace(/\s+/g, " ").trim();
  const withHash = raw.startsWith("#") ? raw : `#${raw}`;
  const display = clip(withHash, 48) || withHash;
  return `Link points at ${display} which is not on the page`;
}

export function deadHashIssue(hit: DeadHashHit): QualityIssue | undefined {
  if (!hit) return undefined;
  const where = String(hit.where || "").replace(/\s+/g, " ").trim();
  const rawHash = String(hit.hash || "").replace(/\s+/g, " ").trim();
  if (!where || !rawHash) return undefined;
  const href = rawHash.includes("#") ? rawHash : `#${rawHash}`;
  if (skipDeadHashHref(href)) return undefined;
  return {
    source: "visual",
    rule: "deadHash",
    severity: "warning",
    confidence: "high",
    count: 1,
    where,
    message: deadHashMessage(href.includes("#") ? href.slice(href.indexOf("#")) : href),
  };
}

export function issuesFromDeadHashHits(hits: DeadHashHit[]): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(hits)) return issues;
  for (const hit of hits) {
    const issue = deadHashIssue(hit);
    if (!issue) continue;
    const key = `${issue.where}\0${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
    if (issues.length >= MAX_DEAD_HASH_HITS) break;
  }
  return issues;
}

/**
 * Browser-side. Source string so tsx/esbuild `__name` helpers are not
 * serialized into the page.
 */
const COLLECT_SRC = `(() => {
  var MAX_HITS = ${MAX_DEAD_HASH_HITS};
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
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    } else {
      var csFallback = window.getComputedStyle(el);
      if (csFallback.display === "none" || csFallback.visibility === "hidden") return false;
    }
    var cs = window.getComputedStyle(el);
    if (cs.display === "none") return false;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    return true;
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
    var named =
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      el.getAttribute("alt") ||
      el.getAttribute("name") ||
      el.getAttribute("placeholder");
    if (named && named.trim()) return tag + ' "' + clip(named.trim(), 40) + '"';
    var text = (el.innerText || "").replace(/\\s+/g, " ").trim();
    if (text) return tag + ' "' + clip(text, 40) + '"';
    var href = el.getAttribute("href");
    if (href && href.trim()) return tag + '[href="' + clip(href.trim(), 48) + '"]';
    return tag;
  }

  function decodeFrag(raw) {
    var s = String(raw || "");
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s;
    }
  }

  function skipFrag(href) {
    var raw = String(href || "").trim();
    if (!raw) return true;
    if (/^javascript:/i.test(raw)) return true;
    var hashAt = raw.indexOf("#");
    var fragRaw = hashAt >= 0 ? raw.slice(hashAt + 1) : raw;
    var frag = decodeFrag(fragRaw).trim();
    if (!frag) return true;
    if (/^javascript:/i.test(frag)) return true;
    if (frag.toLowerCase() === "top") return true;
    if (frag.charAt(0) === "/" || frag.charAt(0) === "!") return true;
    if (/[/?&=]/.test(frag)) return true;
    return false;
  }

  function hasTarget(id) {
    if (!id) return false;
    if (document.getElementById(id)) return true;
    try {
      var esc = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(id) : id;
      if (document.querySelector("a[name='" + esc + "']")) return true;
    } catch (e) {}
    return false;
  }

  var nodes = document.querySelectorAll('a[href^="#"]');
  var n;
  for (n = 0; n < nodes.length; n++) {
    var el = nodes[n];
    var href = el.getAttribute("href") || "";
    if (skipFrag(href)) continue;
    if (!shown(el)) continue;
    var hashAt = href.indexOf("#");
    var fragRaw = hashAt >= 0 ? href.slice(hashAt + 1) : "";
    var id = decodeFrag(fragRaw);
    if (hasTarget(id)) continue;
    var where = describeWhere(el);
    if (!where) continue;
    var hash = "#" + fragRaw;
    var key = where + "\\0" + hash;
    if (seen[key]) continue;
    seen[key] = true;
    hits.push({ hash: hash, where: where });
    if (hits.length >= MAX_HITS) break;
  }
  return hits;
})()`;

export async function scanDeadHash(page: Page): Promise<QualityIssue[]> {
  const raw = (await page.evaluate(COLLECT_SRC).catch(() => [])) as DeadHashHit[];
  if (!Array.isArray(raw)) return [];
  return issuesFromDeadHashHits(raw);
}
