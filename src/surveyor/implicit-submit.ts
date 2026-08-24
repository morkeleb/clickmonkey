import type { Page } from "playwright";
import type { QualityIssue } from "../schema/quality.js";

/** Missing type on `<button>` is submit. Extra ones inside a form fire it. */
export const MAX_IMPLICIT_SUBMIT_HITS = 8;

export type ImplicitSubmitHit = {
  name: string;
  where: string;
};

/** Only the `button` element — not `<input type="button">`. */
export const BUTTON_SELECTOR = "button";

export function missingButtonType(type: string | null | undefined): boolean {
  return !hasExplicitButtonType(type);
}

export function hasExplicitButtonType(type: string | null | undefined): boolean {
  const t = String(type ?? "")
    .trim()
    .toLowerCase();
  return t === "button" || t === "submit" || t === "reset";
}

export function isFormAssociated(opts: {
  inForm?: boolean;
  formAttr?: string | null;
  formExists?: boolean;
}): boolean {
  if (opts.inForm) return true;
  const id = String(opts.formAttr ?? "").trim();
  return Boolean(id && opts.formExists);
}

export function skipImplicitSubmit(opts: {
  tag?: string;
  type?: string | null;
  inForm?: boolean;
  formAttr?: string | null;
  formExists?: boolean;
  disabled?: boolean;
  ariaDisabled?: string | null;
  ariaHidden?: boolean;
  inToolbar?: boolean;
  hidden?: boolean;
  zeroBox?: boolean;
}): boolean {
  const tag = (opts.tag || "button").toLowerCase();
  if (tag !== "button") return true;
  if (!missingButtonType(opts.type)) return true;
  if (!isFormAssociated(opts)) return true;
  if (opts.disabled || opts.ariaDisabled === "true") return true;
  if (opts.ariaHidden) return true;
  if (opts.inToolbar) return true;
  if (opts.hidden || opts.zeroBox) return true;
  return false;
}

export function implicitSubmitMessage(name: string): string {
  const n = String(name || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!n || n.toLowerCase() === "button") {
    return "Button has no type and will submit the form";
  }
  return `Button ${n} has no type and will submit the form`;
}

export function implicitSubmitIssue(hit: ImplicitSubmitHit): QualityIssue | undefined {
  if (!hit) return undefined;
  const name = String(hit.name || "")
    .replace(/\s+/g, " ")
    .trim();
  const where = String(hit.where || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name || !where) return undefined;
  return {
    source: "visual",
    rule: "implicitSubmit",
    severity: "warning",
    confidence: "high",
    count: 1,
    where,
    message: implicitSubmitMessage(name),
  };
}

export function issuesFromImplicitSubmitHits(hits: ImplicitSubmitHit[]): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(hits)) return issues;
  for (const hit of hits) {
    const issue = implicitSubmitIssue(hit);
    if (!issue) continue;
    const key = `${issue.where}\0${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
    if (issues.length >= MAX_IMPLICIT_SUBMIT_HITS) break;
  }
  return issues;
}

/**
 * Browser-side. Source string so tsx/esbuild `__name` helpers are not
 * serialized into the page.
 */
const COLLECT_SRC = `(() => {
  var MAX_HITS = ${MAX_IMPLICIT_SUBMIT_HITS};
  var hits = [];
  var seen = {};
  var vw = window.innerWidth || 0;

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
    }
    var cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (parseFloat(cs.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (r.right <= 0 || r.left >= vw || r.bottom <= 0) return false;
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

  function hasFormOwner(el) {
    if (el.form) return true;
    var attr = el.getAttribute("form");
    if (attr != null) {
      var id = String(attr).trim();
      if (!id) return false;
      var node = document.getElementById(id);
      return Boolean(node && String(node.tagName || "").toLowerCase() === "form");
    }
    return Boolean(el.closest && el.closest("form"));
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
    return tag;
  }

  var nodes = document.querySelectorAll("button");
  var n;
  for (n = 0; n < nodes.length; n++) {
    var el = nodes[n];
    var typeAttr = el.getAttribute("type");
    var t = String(typeAttr || "").trim().toLowerCase();
    if (t === "button" || t === "submit" || t === "reset") continue;
    if (!shown(el)) continue;
    if (isDisabled(el)) continue;
    if (isAriaHidden(el)) continue;
    if (el.closest && el.closest("[role='toolbar']")) continue;
    if (!hasFormOwner(el)) continue;
    var name = widgetName(el) || "Button";
    var where = describeWhere(el);
    if (!where) continue;
    var key = where + "\\0" + name;
    if (seen[key]) continue;
    seen[key] = true;
    hits.push({ name: name, where: where });
    if (hits.length >= MAX_HITS) break;
  }
  return hits;
})()`;

export async function scanImplicitSubmit(page: Page): Promise<QualityIssue[]> {
  const raw = (await page.evaluate(COLLECT_SRC).catch(() => [])) as ImplicitSubmitHit[];
  if (!Array.isArray(raw)) return [];
  return issuesFromImplicitSubmitHits(raw);
}
