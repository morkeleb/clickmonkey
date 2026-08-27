import type { Locator as PwLocator, Page } from "playwright";
import { oneLineBug, stripAnsi } from "../schema/dsl.js";
import { describeInterceptorHtml } from "../surveyor/where.js";
import { actionDeadline, sliceTimeoutMs } from "./timeout.js";
import { LISTED_CLICK_MS } from "./typeahead.js";

const USELESS_HIT = /^(html|body|html\b.*|body\b.*)$/i;

export function isUselessClickHit(name: string | undefined): boolean {
  const s = (name ?? "").replace(/\s+/g, " ").trim();
  if (!s) return true;
  if (s === "html" || s === "body") return true;
  if (USELESS_HIT.test(s)) return true;
  if (/^html\b/i.test(s) && !s.includes("[") && !s.includes('"') && !s.includes(".")) return true;
  return false;
}

/** Last `<tag …> intercepts pointer events` in a Playwright error. */
export function parsePlaywrightInterceptor(error: string): string | undefined {
  const clean = stripAnsi(error);
  const matches = [...clean.matchAll(/<([^>\n]+)> intercepts pointer events/gi)];
  const last = matches.at(-1)?.[1];
  if (!last) return undefined;
  const named = describeInterceptorHtml(`<${last}>`);
  if (!named || isUselessClickHit(named)) return undefined;
  return named;
}

export function clickFailureMessage(opts: {
  widgetKey: string;
  error: string;
  hit?: string;
}): string {
  const hit = (opts.hit ?? "").replace(/\s+/g, " ").trim();
  if (hit && !isUselessClickHit(hit)) {
    return `${opts.widgetKey} click hit ${hit} instead of the control`;
  }
  const fromLog = parsePlaywrightInterceptor(opts.error);
  if (fromLog) return `${opts.widgetKey} click hit ${fromLog} instead of the control`;
  return oneLineBug(opts.error) || `${opts.widgetKey} click failed`;
}

export function coveredByMessage(widgetKey: string, hit?: string): string {
  const named = (hit ?? "").replace(/\s+/g, " ").trim();
  if (named && !isUselessClickHit(named)) return `${widgetKey} is covered by ${named}`;
  return `${widgetKey} is covered by another layer`;
}

const HIT_AT_SRC = `(p) => {
  var x = p && p.x;
  var y = p && p.y;
  var vw = window.innerWidth || 0;
  var vh = window.innerHeight || 0;
  if (!(x >= 0 && y >= 0 && x <= vw && y <= vh)) return "";
  var el = document.elementFromPoint(x, y);
  if (!el) return "";
  function clip(s, n) {
    var one = String(s || "").replace(/\\s+/g, " ").trim();
    if (!one) return "";
    return one.length <= n ? one : one.slice(0, n - 1) + "…";
  }
  function generatedId(id) {
    if (!id) return true;
    if (String(id).charAt(0) === ":") return true;
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) return true;
    return false;
  }
  function describeWhere(node) {
    if (!node || !node.getAttribute) return "";
    var tag = (node.tagName || "el").toLowerCase();
    var hooks = ["data-testid", "data-test-id", "data-test", "data-cy"];
    var i;
    for (i = 0; i < hooks.length; i++) {
      var hook = node.getAttribute(hooks[i]);
      if (hook && hook.trim()) return tag + "[" + hooks[i] + '="' + clip(hook.trim(), 40) + '"]';
    }
    var id = node.id && String(node.id).trim();
    if (id && !generatedId(id)) return "#" + clip(id, 40);
    var named =
      node.getAttribute("aria-label") ||
      node.getAttribute("title") ||
      node.getAttribute("alt") ||
      node.getAttribute("name") ||
      node.getAttribute("placeholder");
    if (named && named.trim()) return tag + ' "' + clip(named.trim(), 40) + '"';
    var role = (node.getAttribute("role") || "").toLowerCase();
    var text = (node.innerText || node.textContent || "").replace(/\\s+/g, " ").trim();
    if (text && (role === "button" || role === "menuitem" || role === "tab" || role === "link" || tag === "button" || tag === "a" || tag === "label")) {
      return tag + ' "' + clip(text, 40) + '"';
    }
    if (text && text.length <= 40) return tag + ' "' + clip(text, 40) + '"';
    var cls = (node.getAttribute("class") || "").trim().split(/\\s+/)[0];
    if (cls) return tag + "." + clip(cls, 24);
    if (role) return tag + '[role="' + clip(role, 24) + '"]';
    return tag;
  }
  function isWidget(node) {
    if (!node || !node.tagName) return false;
    var tag = node.tagName.toLowerCase();
    if (tag === "button" || tag === "select" || tag === "textarea") return true;
    if (tag === "a" && node.hasAttribute("href")) return true;
    if (tag === "input" && (node.type || "").toLowerCase() !== "hidden") return true;
    var role = (node.getAttribute("role") || "").toLowerCase();
    return role === "button" || role === "link" || role === "tab" || role === "menuitem" || role === "option" || role === "menu" || role === "listbox" || role === "dialog";
  }
  var n = el;
  var depth = 0;
  while (n && depth < 8 && n !== document.body && n !== document.documentElement) {
    if (isWidget(n)) {
      var w = describeWhere(n);
      if (w) return w;
    }
    n = n.parentElement;
    depth++;
  }
  n = el;
  depth = 0;
  while (n && depth < 8 && n !== document.body && n !== document.documentElement) {
    var d = describeWhere(n);
    if (d && (d.indexOf('"') >= 0 || d.indexOf("[") >= 0 || d.charAt(0) === "#" || d.indexOf(".") >= 0)) return d;
    n = n.parentElement;
    depth++;
  }
  return describeWhere(el);
}`;

async function centerOf(loc: PwLocator): Promise<{ x: number; y: number } | undefined> {
  const box = await loc.boundingBox().catch(() => null);
  if (!box || !(box.width > 0) || !(box.height > 0)) return undefined;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** What is under the pointer at the control's center — the click that actually landed. */
export async function describeClickHit(loc: PwLocator, page: Page): Promise<string | undefined> {
  const p = await centerOf(loc);
  if (!p) return undefined;
  const raw = await page.evaluate(`(${HIT_AT_SRC})(${JSON.stringify(p)})`).catch(() => "");
  const hit = String(raw || "").replace(/\s+/g, " ").trim();
  if (!hit || isUselessClickHit(hit)) return undefined;
  return hit;
}

const COVER_KIND_SRC = `(p) => {
  var x = p && p.x;
  var y = p && p.y;
  var vw = window.innerWidth || 0;
  var vh = window.innerHeight || 0;
  if (!(x >= 0 && y >= 0 && x <= vw && y <= vh)) return "";
  var el = document.elementFromPoint(x, y);
  if (!el) return "";
  var n = el;
  var depth = 0;
  while (n && depth < 10 && n !== document.body && n !== document.documentElement) {
    var tag = (n.tagName || "").toLowerCase();
    var role = (n.getAttribute && n.getAttribute("role") || "").toLowerCase();
    if (tag === "dialog" || role === "dialog" || (n.getAttribute && n.getAttribute("aria-modal") === "true")) return "dialog";
    if (role === "menu" || role === "listbox" || role === "tooltip" || role === "option" || role === "menuitem") return "menu";
    if (n.hasAttribute && n.hasAttribute("popover")) return "menu";
    var cls = (" " + String(n.getAttribute && n.getAttribute("class") || "").replace(/[-_]/g, " ") + " ").toLowerCase();
    if (cls.indexOf(" menu surface ") >= 0 || cls.indexOf(" mdc menu ") >= 0) return "menu";
    n = n.parentElement;
    depth++;
  }
  return "";
}`;

const OPEN_PICKER =
  '[role="listbox"]:visible, [role="menu"]:visible, [role="option"]:visible, [role="combobox"][aria-expanded="true"], [aria-haspopup="listbox"][aria-expanded="true"]';

async function pickerStillOpen(page: Page): Promise<boolean> {
  return (await page.locator(OPEN_PICKER).count().catch(() => 0)) > 0;
}

type Point = { x: number; y: number };

function clipPoint(x: number, y: number, vw: number, vh: number): Point {
  return {
    x: Math.min(Math.max(x, 24), vw - 8),
    y: Math.min(Math.max(y, 80), vh - 24),
  };
}

/** Click just outside a leftover picker — not 0,0, not tab chrome, not Save/Close. */
async function clickOutsidePicker(page: Page, from?: PwLocator): Promise<void> {
  const seed = from ?? page.locator('[role="option"]:visible, [role="listbox"]:visible, [role="menu"]:visible').first();
  const box = await seed.boundingBox().catch(() => null);
  const vw = page.viewportSize()?.width ?? 1280;
  const vh = page.viewportSize()?.height ?? 800;
  const points: Point[] = [];
  if (box) {
    points.push(clipPoint(box.x + 8, box.y + box.height + 16, vw, vh));
    points.push(clipPoint(box.x + box.width + 16, box.y + box.height / 2, vw, vh));
    points.push(clipPoint(box.x + box.width + 16, box.y + box.height + 16, vw, vh));
  }
  points.push(clipPoint(vw / 2, Math.max(vh * 0.6, 80), vw, vh));
  for (const p of points) {
    const used = await page
      .evaluate(({ x, y }) => {
        const g = globalThis as unknown as {
          document: {
            elementFromPoint(x: number, y: number): {
              closest(sel: string): unknown;
              getAttribute?(name: string): string | null;
              innerText?: string;
              dispatchEvent(e: unknown): void;
            } | null;
          };
          MouseEvent: new (type: string, init: unknown) => unknown;
        };
        const top = g.document.elementFromPoint(x, y);
        if (!top) return false;
        if (top.closest('[role="tab"], [role="tablist"], nav, a[href]')) return false;
        const btn = top.closest("button, [role='button']") as {
          getAttribute?(name: string): string | null;
          innerText?: string;
        } | null;
        if (btn) {
          const t = `${btn.getAttribute?.("aria-label") ?? ""} ${btn.innerText ?? ""}`.replace(/\s+/g, " ").trim();
          if (/^(close\b|save\b|cancel\b|submit\b)/i.test(t) || /^close /i.test(t)) return false;
        }
        top.dispatchEvent(new g.MouseEvent("mousedown", { bubbles: true, clientX: x, clientY: y }));
        top.dispatchEvent(new g.MouseEvent("click", { bubbles: true, clientX: x, clientY: y }));
        return true;
      }, p)
      .catch(() => false);
    if (used) return;
  }
}

async function overlayCovers(loc: PwLocator, page: Page): Promise<boolean> {
  const p = await centerOf(loc.first());
  if (!p) return false;
  const kind = String(await page.evaluate(`(${COVER_KIND_SRC})(${JSON.stringify(p)})`).catch(() => ""));
  if (kind === "menu") return true;
  return Boolean(
    await loc
      .first()
      .evaluate((el, pt: { x: number; y: number }) => {
        const g = globalThis as unknown as {
          document: { elementFromPoint(x: number, y: number): { closest(sel: string): unknown } | null };
        };
        const top = g.document.elementFromPoint(pt.x, pt.y);
        const host = el as { contains(n: unknown): boolean };
        if (!top || el === top || host.contains(top)) return false;
        return Boolean(
          top.closest("button, [role='button'], [role='option'], [role='listbox'], [role='menu']"),
        );
      }, p)
      .catch(() => false),
  );
}

/**
 * Collapse a leftover typeahead/select picker after a listed-row click.
 * Many painted lists are a popover of buttons, not `role=listbox`, so Escape
 * alone is not enough — click the still-expanded combobox, then outside.
 */
export async function closeOpenOverlays(page: Page, from?: PwLocator): Promise<void> {
  const deadline = actionDeadline(page);
  const esc = sliceTimeoutMs(deadline, { cap: LISTED_CLICK_MS });
  if (esc > 0) await page.keyboard.press("Escape").catch(() => undefined);
  if (!(await pickerStillOpen(page))) return;
  const expanded = page.locator(
    '[role="combobox"][aria-expanded="true"], [aria-haspopup="listbox"][aria-expanded="true"]',
  );
  if ((await expanded.count().catch(() => 0)) > 0) {
    const clickMs = sliceTimeoutMs(deadline, { cap: LISTED_CLICK_MS });
    if (clickMs > 0) await expanded.first().click({ timeout: clickMs, force: true }).catch(() => undefined);
  }
  const esc2 = sliceTimeoutMs(deadline, { cap: LISTED_CLICK_MS });
  if (esc2 > 0) await page.keyboard.press("Escape").catch(() => undefined);
  if (!(await pickerStillOpen(page))) return;
  await clickOutsidePicker(page, from);
  const esc3 = sliceTimeoutMs(deadline, { cap: LISTED_CLICK_MS });
  if (esc3 > 0) await page.keyboard.press("Escape").catch(() => undefined);
}

/** Leftover menu/listbox over the target — not a dialog we are filling. */
export async function dismissLeftoverMenuCover(loc: PwLocator, page: Page): Promise<boolean> {
  if (!(await overlayCovers(loc, page))) return false;
  await closeOpenOverlays(page, loc);
  // Painted typeahead rows are often `<button>`s, not role=listbox — Escape
  // then looks "closed" while the leftover still covers the next field.
  if (await overlayCovers(loc, page)) await clickOutsidePicker(page, loc);
  return true;
}
