import type { Page } from "playwright";
import type { QualityIssue } from "../schema/quality.js";

/** Shown, enabled actables that swallow mouse hits. */
export const MAX_POINTER_EVENTS_HITS = 8;

export const ACTABLE_SEL =
  "button, a[href], input:not([type='hidden']), select, textarea, [role='button'], [role='link'], [role='tab']";

export type PointerEventsHit = {
  name: string;
  where: string;
};

/** Own computed value only — pointer-events is not inherited. */
export function isPointerEventsNone(value: string | undefined): boolean {
  return String(value ?? "").trim().toLowerCase() === "none";
}

export function skipDisabled(opts: {
  disabled?: boolean;
  ariaDisabled?: string | null;
}): boolean {
  return Boolean(opts.disabled) || opts.ariaDisabled === "true";
}

export function skipAriaHidden(ariaHidden: string | null | undefined): boolean {
  return ariaHidden === "true";
}

export function skipPointerEventsControl(opts: {
  disabled?: boolean;
  ariaDisabled?: string | null;
  ariaHidden?: string | null;
  inertAncestor?: boolean;
  shown?: boolean;
}): boolean {
  if (opts.shown === false) return true;
  if (skipDisabled(opts)) return true;
  if (skipAriaHidden(opts.ariaHidden)) return true;
  if (opts.inertAncestor) return true;
  return false;
}

export function pointerEventsMessage(name: string): string {
  const n = name.replace(/\s+/g, " ").trim() || "Control";
  return `${n} ignores pointer events (pointer-events: none)`;
}

export function pointerEventsIssue(hit: PointerEventsHit): QualityIssue | undefined {
  if (!hit) return undefined;
  const name = String(hit.name || "").replace(/\s+/g, " ").trim();
  const where = String(hit.where || "").replace(/\s+/g, " ").trim();
  if (!name || !where) return undefined;
  return {
    source: "visual",
    rule: "pointerEvents",
    severity: "error",
    confidence: "high",
    count: 1,
    where,
    message: pointerEventsMessage(name),
  };
}

export function issuesFromHits(hits: PointerEventsHit[]): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(hits)) return issues;
  for (const hit of hits) {
    const issue = pointerEventsIssue(hit);
    if (!issue) continue;
    const key = `${issue.where}\0${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
    if (issues.length >= MAX_POINTER_EVENTS_HITS) break;
  }
  return issues;
}

/**
 * Browser-side. Source string so tsx/esbuild `__name` helpers are not
 * serialized into the page.
 */
const COLLECT_SRC = `(() => {
  var SEL = ${JSON.stringify(ACTABLE_SEL)};
  var MAX_HITS = ${MAX_POINTER_EVENTS_HITS};
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
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    }
    var cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (parseFloat(cs.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (r.right <= 0 || r.bottom <= 0) return false;
    return true;
  }

  function isDisabled(el) {
    if (el.disabled) return true;
    if (el.getAttribute("aria-disabled") === "true") return true;
    if (typeof el.matches === "function" && el.matches(":disabled")) return true;
    return false;
  }

  function isAriaHidden(el) {
    if (!el) return false;
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return true;
    if (el.closest && el.closest("[aria-hidden='true']")) return true;
    return false;
  }

  function widgetName(el) {
    var aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return clip(aria, 40);
    var labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      var labelled = labelledBy.split(/\\s+/).map(function (id) {
        var node = document.getElementById(id);
        return node ? node.innerText : "";
      }).join(" ").trim();
      if (labelled) return clip(labelled, 40);
    }
    var text = (el.innerText || el.value || "").replace(/\\s+/g, " ").trim();
    if (text) return clip(text, 40);
    var testid = el.getAttribute("data-testid");
    if (testid && testid.trim()) return clip(testid, 40);
    if (el.id && String(el.id).trim()) return clip(el.id, 40);
    var named = el.getAttribute("name") || el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("alt");
    if (named && named.trim()) return clip(named, 40);
    return el.tagName.toLowerCase();
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

  var nodes = document.querySelectorAll(SEL);
  var n;
  for (n = 0; n < nodes.length; n++) {
    var el = nodes[n];
    if (!shown(el) || isDisabled(el) || isAriaHidden(el)) continue;
    // Not inherited; parent none + child auto is still clickable.
    var pe = window.getComputedStyle(el).pointerEvents;
    if (String(pe || "").toLowerCase() !== "none") continue;
    var name = widgetName(el) || "Control";
    var where = describeWhere(el);
    if (!name || !where) continue;
    var key = where + "\\0" + name;
    if (seen[key]) continue;
    seen[key] = true;
    hits.push({ name: name, where: where });
    if (hits.length >= MAX_HITS) break;
  }
  return hits;
})()`;

export async function scanPointerEvents(page: Page): Promise<QualityIssue[]> {
  const raw = (await page.evaluate(COLLECT_SRC).catch(() => [])) as PointerEventsHit[];
  if (!Array.isArray(raw)) return [];
  return issuesFromHits(raw);
}
