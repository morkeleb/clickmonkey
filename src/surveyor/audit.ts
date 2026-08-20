import type { Locator as PwLocator, Page } from "playwright";
import {
  dedupeIssues,
  isInsufficient,
  type TestabilityIssue,
} from "../schema/testability.js";

export interface AuditOptions {
  excludeVisibleDialogs?: boolean;
  checkMain?: boolean;
}

export interface AuditResult {
  issues: TestabilityIssue[];
  insufficient: boolean;
}

type AuditFlags = {
  excludeVisibleDialogs: boolean;
  checkMain: boolean;
};

/**
 * Function body (args: root, flags). Kept as source text so tsx/esbuild
 * `__name` helpers are not serialized into the page.
 */
const AUDIT_SRC = `
var DIALOG_SEL = "dialog, [role='dialog'], [aria-modal='true']";
var FIELD_SEL = 'input, select, textarea, [contenteditable="true"]';
var ACTION_SEL = 'button, a[href], [role="button"], input[type="submit"], input[type="button"]';
var EXTRA_SEL = "[onclick], [tabindex]";
var doc = document;
var issues = [];
var els;
var i;
var el;

function shown(node) {
  if (!node) return false;
  if (typeof node.checkVisibility === "function") {
    return node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  }
  return true;
}
function insideForeignDialog(node) {
  var host = node.closest(DIALOG_SEL);
  return Boolean(host && host !== node && host !== root);
}
function accName(node) {
  var aria = node.getAttribute("aria-label");
  if (aria && aria.trim()) return aria.trim();
  var labelledBy = node.getAttribute("aria-labelledby");
  if (labelledBy) {
    var text = labelledBy.split(/\\s+/).map(function (id) {
      var hit = doc.getElementById(id);
      return hit ? hit.innerText : "";
    }).join(" ").trim();
    if (text) return text;
  }
  return (node.innerText || "").trim();
}
function labelText(node) {
  if (node.id) {
    var escaped = (typeof CSS !== "undefined" && CSS.escape) ? CSS.escape(node.id) : node.id;
    var lab = doc.querySelector('label[for="' + escaped + '"]');
    var t = lab ? lab.innerText.trim() : "";
    if (t) return t;
  }
  var wrap = node.closest("label");
  return wrap ? wrap.innerText.trim() : "";
}
function implicitRole(node) {
  var roleAttr = node.getAttribute("role");
  if (roleAttr && roleAttr.trim()) return roleAttr.trim();
  var tag = node.tagName.toLowerCase();
  var inputType = tag === "input" ? node.type || "text" : "";
  if (tag === "button") return "button";
  if (tag === "a" && node.hasAttribute("href")) return "link";
  if (tag === "dialog") return "dialog";
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (tag === "input") {
    if (["text", "email", "password", "search", "tel", "url"].indexOf(inputType) >= 0) return "textbox";
    if (inputType === "checkbox") return "checkbox";
    if (inputType === "radio") return "radio";
    if (inputType === "number") return "spinbutton";
    if (inputType === "submit" || inputType === "button") return "button";
  }
  return "";
}
function canLocate(kind, node) {
  if (node.getAttribute("data-testid") && node.getAttribute("data-testid").trim()) return true;
  if (kind === "field" && node.getAttribute("name") && node.getAttribute("name").trim()) return true;
  if (implicitRole(node) && accName(node)) return true;
  if (labelText(node)) return true;
  return false;
}
function named(node) {
  return Boolean(accName(node) || labelText(node));
}
function hasStableId(node) {
  if (node.id && String(node.id).trim()) return true;
  var hooks = ["data-testid", "data-test-id", "data-test", "data-cy"];
  var h;
  for (h = 0; h < hooks.length; h++) {
    var hook = node.getAttribute(hooks[h]);
    if (hook && hook.trim()) return true;
  }
  return false;
}
function generatedId(id) {
  if (!id) return true;
  if (id.charAt(0) === ":") return true;
  if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) return true;
  return false;
}
function clip(s, n) {
  var one = String(s).replace(/\\s+/g, " ").trim();
  return one.length <= n ? one : one.slice(0, n - 1) + "…";
}
function describeWhere(node) {
  var tag = node.tagName.toLowerCase();
  var hooks = ["data-testid", "data-test-id", "data-test", "data-cy"];
  var h;
  for (h = 0; h < hooks.length; h++) {
    var hook = node.getAttribute(hooks[h]);
    if (hook && hook.trim()) return tag + "[" + hooks[h] + '="' + clip(hook.trim(), 40) + '"]';
  }
  var id = node.id && String(node.id).trim();
  if (id && !generatedId(id)) return "#" + clip(id, 40);
  var named = node.getAttribute("aria-label") || node.getAttribute("alt") || node.getAttribute("title") || node.getAttribute("name") || node.getAttribute("placeholder");
  if (named && named.trim()) return tag + ' "' + clip(named.trim(), 40) + '"';
  var text = (accName(node) || labelText(node) || "").replace(/\\s+/g, " ").trim();
  if (text) return tag + ' "' + clip(text, 40) + '"';
  var href = node.getAttribute("href");
  if (href && href.trim()) return tag + '[href="' + clip(href.trim(), 48) + '"]';
  return tag;
}
function push(code, severity, node) {
  var tag = node.tagName.toLowerCase();
  var role = implicitRole(node);
  var inputType = tag === "input" ? node.type || "text" : "";
  var item = { code: code, severity: severity, tag: tag };
  if (role) item.role = role;
  if (inputType) item.inputType = inputType;
  var where = describeWhere(node);
  if (where) item.where = where;
  issues.push(item);
}

els = root.querySelectorAll(FIELD_SEL);
for (i = 0; i < els.length; i++) {
  el = els[i];
  if (!shown(el)) continue;
  if (flags.excludeVisibleDialogs && insideForeignDialog(el)) continue;
  var fTag = el.tagName.toLowerCase();
  var fType = fTag === "input" ? el.type || "text" : "";
  if (fType === "hidden" || fType === "submit" || fType === "button") continue;
  if (!canLocate("field", el)) push("opaqueControl", "block", el);
  else if (!named(el)) push("unlabeledField", "warn", el);
  if (!hasStableId(el)) push("missingStableId", "warn", el);
}

els = root.querySelectorAll(ACTION_SEL);
var nameCounts = {};
for (i = 0; i < els.length; i++) {
  el = els[i];
  if (!shown(el)) continue;
  if (flags.excludeVisibleDialogs && insideForeignDialog(el)) continue;
  if (!canLocate("action", el)) push("opaqueControl", "block", el);
  else if (!named(el)) push("unnamedControl", "warn", el);
  if (!hasStableId(el)) push("missingStableId", "warn", el);
  var dupName = (accName(el) || labelText(el) || "").replace(/\\s+/g, " ").trim().toLowerCase();
  var dupRole = implicitRole(el) || el.tagName.toLowerCase();
  if (dupName) {
    var dupKey = dupRole + "\\0" + dupName;
    if (!nameCounts[dupKey]) nameCounts[dupKey] = 0;
    nameCounts[dupKey] += 1;
  }
}
var dupKeys = Object.keys(nameCounts);
for (i = 0; i < dupKeys.length; i++) {
  if (nameCounts[dupKeys[i]] < 2) continue;
  var bits = dupKeys[i].split("\\0");
  var dupItem = { code: "duplicateName", severity: "warn", tag: "widget", role: bits[0] };
  if (bits[1]) dupItem.where = bits[0] + ' "' + clip(bits[1], 40) + '"';
  issues.push(dupItem);
}

els = root.querySelectorAll(EXTRA_SEL);
for (i = 0; i < els.length; i++) {
  el = els[i];
  if (!shown(el)) continue;
  if (flags.excludeVisibleDialogs && insideForeignDialog(el)) continue;
  var eTag = el.tagName.toLowerCase();
  if (eTag === "input" || eTag === "select" || eTag === "textarea" || eTag === "button" || eTag === "a") continue;
  if (el.getAttribute("role") === "button") continue;
  if (el.tabIndex < 0 && !el.hasAttribute("onclick")) continue;
  push("clickableNonWidget", "block", el);
}

var dialogRoots = [];
var selfRole = root.getAttribute("role");
var selfTag = root.tagName.toLowerCase();
if (selfTag === "dialog" || selfRole === "dialog" || root.getAttribute("aria-modal") === "true") {
  dialogRoots.push(root);
}
if (flags.checkMain) {
  els = root.querySelectorAll(DIALOG_SEL);
  for (i = 0; i < els.length; i++) {
    if (shown(els[i])) dialogRoots.push(els[i]);
  }
}
for (i = 0; i < dialogRoots.length; i++) {
  el = dialogRoots[i];
  var labelled = Boolean(
    (el.getAttribute("data-testid") && el.getAttribute("data-testid").trim()) ||
    (el.getAttribute("aria-label") && el.getAttribute("aria-label").trim()) ||
    (el.getAttribute("aria-labelledby") && el.getAttribute("aria-labelledby").trim())
  );
  if (!labelled) push("unnamedDialog", "block", el);
}

if (flags.checkMain) {
  var main = doc.querySelector("main, [role='main']");
  if (!shown(main)) {
    issues.push({ code: "noMain", severity: "warn", tag: "document" });
  }
}

return issues;
`;

function isPage(root: Page | PwLocator): root is Page {
  return typeof (root as Page).locator === "function" && typeof (root as Page).url === "function";
}

export async function auditVisible(
  page: Page,
  root: Page | PwLocator,
  opts: AuditOptions = {},
): Promise<AuditResult> {
  const loc = isPage(root) ? page.locator("html") : root;
  if ((await loc.count()) === 0) {
    return { issues: [], insufficient: false };
  }
  const flags: AuditFlags = {
    excludeVisibleDialogs: Boolean(opts.excludeVisibleDialogs),
    checkMain: Boolean(opts.checkMain),
  };
  const raw = await loc.first().evaluate(
    (el, arg) => new Function("root", "flags", arg.src)(el, arg.flags),
    { src: AUDIT_SRC, flags },
  );
  const issues = dedupeIssues(raw as TestabilityIssue[]);
  return { issues, insufficient: isInsufficient(issues) };
}

export function formatTestabilityLine(issues: TestabilityIssue[], insufficient: boolean): string {
  if (issues.length === 0) return "";
  const blocks = issues.filter((i) => i.severity === "block").length;
  const warns = issues.length - blocks;
  const flag = insufficient ? "insufficient" : "warn";
  return `testability: ${flag} (${blocks} block, ${warns} warn)\n`;
}
