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
var WIDGET_ROLES = { button: 1, link: 1, tab: 1, menuitem: 1, option: 1, combobox: 1, checkbox: 1, radio: 1, switch: 1, slider: 1, textbox: 1, searchbox: 1, spinbutton: 1 };
var WIDGET_HOST_SEL = "button, a[href], [role=button], [role=link], [role=tab], [role=menuitem], [role=option], [role=combobox], [role=checkbox], [role=radio], [role=switch], label, input, select, textarea";
var ROW_HOST_SEL = "tr, [role=row], [role=grid], [role=treegrid], [role=listbox], [role=menu], [role=tree], table";
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
function isSemanticWidget(node) {
  var tag = node.tagName.toLowerCase();
  if (tag === "button" || tag === "input" || tag === "select" || tag === "textarea") return true;
  if (tag === "a" && node.hasAttribute("href")) return true;
  var role = (node.getAttribute("role") || "").toLowerCase();
  return Boolean(WIDGET_ROLES[role]);
}
function isCommandRole(node) {
  var role = (node.getAttribute("role") || "").toLowerCase();
  return role === "button" || role === "link" || role === "tab" || role === "menuitem" || role === "checkbox" || role === "radio" || role === "switch";
}
function isNativelyFocusable(node) {
  var tag = node.tagName.toLowerCase();
  if (node.disabled) return false;
  if (node.getAttribute("aria-disabled") === "true") return false;
  if (tag === "button" || tag === "select" || tag === "textarea") return true;
  if (tag === "a" && node.hasAttribute("href")) return true;
  if (tag === "input") return (node.type || "text").toLowerCase() !== "hidden";
  return false;
}
function isKeyboardWidget(node) {
  if (isNativelyFocusable(node)) return true;
  return node.tabIndex >= 0;
}
function inListPopup(node) {
  return Boolean(node.closest && node.closest("[role='listbox'], [role='menu'], [role='tree'], [role='option'], [role='menuitem']"));
}
function isShell(node) {
  var tag = node.tagName.toLowerCase();
  if (tag === "html" || tag === "body" || tag === "main" || tag === "svg" || tag === "path") return true;
  var id = (node.id || "").toLowerCase();
  if (id === "root" || id === "app" || id === "__next" || id === "__nuxt") return true;
  var role = (node.getAttribute("role") || "").toLowerCase();
  return role === "main" || role === "application";
}
function tooBig(node) {
  var r = node.getBoundingClientRect();
  var vw = window.innerWidth || 1;
  var vh = window.innerHeight || 1;
  return r.width * r.height > vw * vh * 0.4;
}
function hasOwnPointer(node) {
  if (node.onclick || node.onmousedown || node.onpointerdown) return true;
  if (node.getAttribute("onclick") || node.getAttribute("onmousedown")) return true;
  var k;
  var keys = Object.keys(node);
  for (k = 0; k < keys.length; k++) {
    var key = keys[k];
    if (key.indexOf("__reactProps") !== 0 && key.indexOf("__reactEventHandlers") !== 0) continue;
    var p = node[key];
    if (p && (p.onClick || p.onMouseDown || p.onPointerDown)) return true;
  }
  return false;
}
function wrapsField(node) {
  return Boolean(node.querySelector && node.querySelector("input, select, textarea, [contenteditable='true']"));
}
function isStepperChrome(node) {
  var testid = (node.getAttribute("data-testid") || "").toLowerCase();
  if (testid.indexOf("stepper") >= 0) return true;
  return Boolean(node.closest && node.closest("[data-testid*='stepper']"));
}
function skipClickableNonWidget(node) {
  var tag = node.tagName.toLowerCase();
  if (tag === "script" || tag === "style" || tag === "noscript" || tag === "link" || tag === "meta") return true;
  if (!shown(node)) return true;
  if (flags.excludeVisibleDialogs && insideForeignDialog(node)) return true;
  if (isSemanticWidget(node)) {
    if (isCommandRole(node) && !isKeyboardWidget(node)) return false;
    return true;
  }
  if (node.closest && node.closest(WIDGET_HOST_SEL)) return true;
  if (tag === "svg" || tag === "path" || tag === "i") return true;
  if (wrapsField(node)) return true;
  if (isStepperChrome(node)) return true;
  if (inListPopup(node)) return true;
  if (node.closest && node.closest(ROW_HOST_SEL)) return true;
  if (isShell(node)) return true;
  if (tooBig(node)) return true;
  return false;
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

els = root.querySelectorAll("*");
var clickableHits = 0;
for (i = 0; i < els.length && clickableHits < 8; i++) {
  el = els[i];
  if (skipClickableNonWidget(el)) continue;
  var pointer = hasOwnPointer(el) || el.hasAttribute("onclick");
  var tabbable = el.tabIndex >= 0;
  var commandUnreachable = isCommandRole(el) && !isKeyboardWidget(el);
  if (!pointer && !tabbable && !commandUnreachable) continue;
  if (!pointer && el.tabIndex < 0 && !commandUnreachable) continue;
  push("clickableNonWidget", "block", el);
  clickableHits += 1;
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

const LISTENER_AUDIT_JS = `(() => {
  var sel = __SEL__;
  var root = document.querySelector(sel);
  if (!root) return [];
  var WIDGET_ROLES = { button: 1, link: 1, tab: 1, menuitem: 1, option: 1, combobox: 1, checkbox: 1, radio: 1, switch: 1, slider: 1, textbox: 1, searchbox: 1, spinbutton: 1 };
  var WIDGET_HOST_SEL = "button, a[href], [role=button], [role=link], [role=tab], [role=menuitem], [role=option], [role=combobox], [role=checkbox], [role=radio], [role=switch], label, input, select, textarea";
  var ROW_HOST_SEL = "tr, [role=row], [role=grid], [role=treegrid], [role=listbox], [role=menu], [role=tree], table";
  var POINTER = { click: 1, mousedown: 1, mouseup: 1, pointerdown: 1, pointerup: 1 };
  var out = [];
  var nodes = root.querySelectorAll("*");
  var i;
  function clip(s, n) {
    var one = String(s || "").replace(/\\s+/g, " ").trim();
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
    if (id) return "#" + clip(id, 40);
    var named = node.getAttribute("aria-label") || node.getAttribute("title") || node.getAttribute("alt");
    if (named && named.trim()) return tag + ' "' + clip(named.trim(), 40) + '"';
    var text = (node.innerText || "").replace(/\\s+/g, " ").trim();
    if (text) return tag + ' "' + clip(text, 40) + '"';
    return tag;
  }
  function skip(node) {
    var tag = node.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript" || tag === "html" || tag === "body" || tag === "main") return true;
    if (typeof node.checkVisibility === "function" && !node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return true;
    if (tag === "button" || tag === "input" || tag === "select" || tag === "textarea") return true;
    if (tag === "a" && node.hasAttribute("href")) return true;
    var role = (node.getAttribute("role") || "").toLowerCase();
    if (WIDGET_ROLES[role]) {
      var command = role === "button" || role === "link" || role === "tab" || role === "menuitem" || role === "checkbox" || role === "radio" || role === "switch";
      var native = tag === "button" || tag === "select" || tag === "textarea" || (tag === "a" && node.hasAttribute("href")) || tag === "input";
      if (command && !native && node.tabIndex < 0) return false;
      return true;
    }
    if (node.closest && node.closest(WIDGET_HOST_SEL)) return true;
    if (tag === "svg" || tag === "path" || tag === "i") return true;
    if (node.querySelector && node.querySelector("input, select, textarea, [contenteditable='true']")) return true;
    var testid = (node.getAttribute("data-testid") || "").toLowerCase();
    if (testid.indexOf("stepper") >= 0) return true;
    if (node.closest && node.closest("[data-testid*='stepper']")) return true;
    if (node.closest && node.closest("[role='listbox'], [role='menu'], [role='tree'], [role='option'], [role='menuitem']")) return true;
    if (node.closest && node.closest(ROW_HOST_SEL)) return true;
    var rid = (node.id || "").toLowerCase();
    if (rid === "root" || rid === "app" || rid === "__next") return true;
    var r = node.getBoundingClientRect();
    var vw = window.innerWidth || 1;
    var vh = window.innerHeight || 1;
    if (r.width * r.height > vw * vh * 0.4) return true;
    return false;
  }
  for (i = 0; i < nodes.length && out.length < 8; i++) {
    var node = nodes[i];
    if (skip(node)) continue;
    var listeners = {};
    try { listeners = getEventListeners(node) || {}; } catch (e) {}
    var types = Object.keys(listeners);
    if (!types.some(function (t) { return POINTER[t]; })) continue;
    out.push({ code: "clickableNonWidget", severity: "block", tag: node.tagName.toLowerCase(), where: describeWhere(node) });
  }
  return out;
})()`;

async function listenerNonWidgets(page: Page, loc: PwLocator): Promise<TestabilityIssue[]> {
  let marked = false;
  try {
    const sel = await loc.first().evaluate((el) => {
      const n = el as { id?: string; tagName?: string; setAttribute(name: string, value: string): void };
      if (n.id) return `[id=${JSON.stringify(n.id)}]`;
      if ((n.tagName || "").toLowerCase() === "html") return "html";
      n.setAttribute("data-cm-audit", "1");
      return "[data-cm-audit='1']";
    });
    marked = sel.includes("data-cm-audit");
    const session = await page.context().newCDPSession(page);
    const { result } = await session.send("Runtime.evaluate", {
      includeCommandLineAPI: true,
      returnByValue: true,
      expression: LISTENER_AUDIT_JS.replace("__SEL__", JSON.stringify(sel)),
    });
    await session.detach().catch(() => undefined);
    const raw = result?.value;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (row): row is TestabilityIssue =>
        Boolean(row && row.code === "clickableNonWidget" && typeof row.tag === "string"),
    );
  } catch {
    return [];
  } finally {
    if (marked) {
      await loc
        .first()
        .evaluate((el) => (el as { removeAttribute(name: string): void }).removeAttribute("data-cm-audit"))
        .catch(() => undefined);
    }
  }
}

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
  const fromDom = Array.isArray(raw) ? (raw as TestabilityIssue[]) : [];
  const fromListeners = await listenerNonWidgets(page, loc);
  const issues = dedupeIssues([...fromDom, ...fromListeners]);
  return { issues, insufficient: isInsufficient(issues) };
}

export function formatTestabilityLine(issues: TestabilityIssue[], insufficient: boolean): string {
  if (issues.length === 0) return "";
  const blocks = issues.filter((i) => i.severity === "block").length;
  const warns = issues.length - blocks;
  const flag = insufficient ? "insufficient" : "warn";
  return `testability: ${flag} (${blocks} block, ${warns} warn)\n`;
}
