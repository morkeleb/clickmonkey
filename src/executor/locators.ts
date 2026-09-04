import type { Locator as PwLocator, Page } from "playwright";
import type { Locator } from "../schema/locator.js";
import { widgetIsCovered } from "./look.js";

type AriaRole = Parameters<PwLocator["getByRole"]>[0];

/** CSS.escape for attribute selectors such as [name="…"]. */
export function cssEscape(value: string): string {
  const length = value.length;
  let index = -1;
  let result = "";
  const firstCodeUnit = value.charCodeAt(0);
  while (++index < length) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0x0000) {
      result += "\uFFFD";
      continue;
    }
    if (
      (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
      codeUnit === 0x007f ||
      (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (index === 1 &&
        codeUnit >= 0x0030 &&
        codeUnit <= 0x0039 &&
        firstCodeUnit === 0x002d)
    ) {
      result += `\\${codeUnit.toString(16)} `;
      continue;
    }
    if (index === 0 && length === 1 && codeUnit === 0x002d) {
      result += `\\${value.charAt(index)}`;
      continue;
    }
    if (
      codeUnit >= 0x0080 ||
      codeUnit === 0x002d ||
      codeUnit === 0x005f ||
      (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
      (codeUnit >= 0x0061 && codeUnit <= 0x007a)
    ) {
      result += value.charAt(index);
      continue;
    }
    result += `\\${value.charAt(index)}`;
  }
  return result;
}

export function toPlaywrightLocator(root: Page | PwLocator, loc: Locator): PwLocator {
  let raw: PwLocator;
  switch (loc.by) {
    case "testId":
      raw = root.getByTestId(loc.value);
      break;
    case "name":
      raw = root.locator(`[name="${cssEscape(loc.value)}"]`);
      break;
    case "role":
      raw = root.getByRole(
        loc.value as AriaRole,
        loc.name ? { name: loc.name, exact: loc.nameExact === false ? false : true } : {},
      );
      break;
    case "label":
      raw = root.getByLabel(loc.value, { exact: true });
      break;
    default: {
      const _never: never = loc.by;
      throw new Error(`unknown locator by ${_never}`);
    }
  }
  // Always pin an index so a later duplicate cannot steal the first widget.
  return loc.nth !== undefined && loc.nth > 0 ? raw.nth(loc.nth) : raw.first();
}

/** Resolve a widget inside its surface (dialog) when the surface has a locator. */
export function widgetLocator(
  page: Page,
  surface: { locator?: Locator } | undefined,
  loc: Locator,
): PwLocator {
  const root = surface?.locator ? toPlaywrightLocator(page, surface.locator) : page;
  return toPlaywrightLocator(root, loc);
}

export const ACTABLE_WAIT_MS = 15_000;
const ACTABLE_POLL_MS = 50;

export type ActableMiss = "missing" | "hidden" | "disabled" | "tiny" | "offscreen" | "covered";

type Box = { x: number; y: number; width: number; height: number };

function isOffscreen(box: Box, vp: { width: number; height: number }): boolean {
  if (box.x + box.width < 0 || box.y + box.height < 0) return true;
  return box.x > vp.width || box.y > vp.height;
}

async function isDisabled(el: PwLocator): Promise<boolean> {
  return el
    .evaluate((node) => {
      const typed = node as { disabled?: boolean; getAttribute(name: string): string | null };
      if (typed.disabled) return true;
      return typed.getAttribute("aria-disabled") === "true";
    })
    .catch(() => true);
}

/** Visible, enabled, painted. Below-the-fold is still interactable. */
async function isInteractable(el: PwLocator): Promise<boolean> {
  if (!(await el.isVisible().catch(() => false))) return false;
  if (await isDisabled(el)) return false;
  const box = await el.boundingBox().catch(() => null);
  return Boolean(box && box.width >= 2 && box.height >= 2);
}

async function inViewport(el: PwLocator, page: Page): Promise<boolean> {
  const box = await el.boundingBox().catch(() => null);
  const vp = page.viewportSize();
  if (!box || !vp) return true;
  return !isOffscreen(box, vp);
}

async function pickActableNow(
  loc: PwLocator,
  page: Page,
  scroll: boolean,
): Promise<PwLocator | undefined> {
  const n = await loc.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    if (!(await isInteractable(el))) continue;
    if (scroll) await el.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => undefined);
    if (!(await isInteractable(el))) continue;
    if (scroll && !(await inViewport(el, page))) continue;
    if (await widgetIsCovered(el)) continue;
    return el;
  }
  return undefined;
}

/**
 * First match that is visible and enabled.
 * Clicks/fills pass `scroll` so a footer below the viewport is brought on-screen
 * before the coverage check. View listing does not scroll.
 * `timeoutMs` waits for a disabled control to enable.
 */
export async function pickActable(
  loc: PwLocator,
  page: Page,
  opts?: { timeoutMs?: number; scroll?: boolean },
): Promise<PwLocator | undefined> {
  const timeoutMs = opts?.timeoutMs ?? 0;
  const scroll = Boolean(opts?.scroll);
  const hit = await pickActableNow(loc, page, scroll);
  if (hit) return hit;
  if (timeoutMs <= 0) return undefined;
  const n = await loc.count().catch(() => 0);
  if (n === 0) return undefined;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const again = await pickActableNow(loc, page, scroll);
    if (again) return again;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return undefined;
    await new Promise((r) => setTimeout(r, Math.min(ACTABLE_POLL_MS, remaining)));
  }
}

export async function explainActableMiss(loc: PwLocator, page: Page): Promise<ActableMiss> {
  const n = await loc.count().catch(() => 0);
  if (n === 0) return "missing";
  const reasons = new Set<ActableMiss>();
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    if (!(await el.isVisible().catch(() => false))) {
      reasons.add("hidden");
      continue;
    }
    if (await isDisabled(el)) {
      reasons.add("disabled");
      continue;
    }
    const box = await el.boundingBox().catch(() => null);
    if (!box || box.width < 2 || box.height < 2) {
      reasons.add("tiny");
      continue;
    }
    await el.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => undefined);
    const after = await el.boundingBox().catch(() => null);
    const vp = page.viewportSize();
    if (after && vp && isOffscreen(after, vp)) reasons.add("offscreen");
    if (await widgetIsCovered(el)) reasons.add("covered");
  }
  if (reasons.has("disabled")) return "disabled";
  if (reasons.has("covered")) return "covered";
  if (reasons.has("offscreen")) return "offscreen";
  if (reasons.has("tiny")) return "tiny";
  return "hidden";
}

export function actableMissHeadline(key: string, miss: ActableMiss): string {
  switch (miss) {
    case "missing":
      return `${key} was not found`;
    case "disabled":
      return `${key} is disabled`;
    case "tiny":
      return `${key} is too small to click`;
    case "offscreen":
      return `${key} is off-screen`;
    case "covered":
      return `${key} is covered by another layer`;
    default:
      return `${key} is not visible`;
  }
}

export type ActableMissExtra = {
  waitSeconds?: number;
  fills?: Array<{ ref: string; value: string }>;
  hints?: string[];
};

/** One-line miss. Pass `extra` on disabled clicks so the finding names fills and edit-mode hints. */
export function actableMissMessage(key: string, miss: ActableMiss, extra?: ActableMissExtra): string {
  const head = actableMissHeadline(key, miss);
  if (miss !== "disabled" || extra === undefined) return head;
  const wait = extra.waitSeconds ?? Math.round(ACTABLE_WAIT_MS / 1000);
  const lines = [
    head,
    "",
    `ClickMonkey waited ${wait}s for it to enable, then gave up. Users cannot finish this screen.`,
  ];
  if (extra.fills && extra.fills.length > 0) {
    lines.push("", "Just filled:");
    for (const f of extra.fills) {
      lines.push(`- \`${f.ref}\` ${JSON.stringify(f.value)}`);
    }
  } else {
    lines.push(
      "",
      "No fills were recorded on this page before the click. Save often stays disabled until a field change is registered (dirty tracking), not because the form is hidden.",
    );
  }
  if (extra.hints && extra.hints.length > 0) {
    lines.push("", ...extra.hints);
  }
  return lines.join("\n");
}

export async function disabledControlHints(loc: PwLocator, page: Page): Promise<string[]> {
  const hints: string[] = [];
  const el = loc.first();
  await el.scrollIntoViewIfNeeded().catch(() => undefined);
  const title = (await el.getAttribute("title").catch(() => null))?.trim();
  if (title) hints.push(`The control's title is ${JSON.stringify(title)}.`);
  const described = await el
    .evaluate((node) => {
      const id = (node as { getAttribute(name: string): string | null }).getAttribute("aria-describedby");
      if (!id) return "";
      return id
        .split(/\s+/)
        .map((part) => node.ownerDocument.getElementById(part)?.innerText ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    })
    .catch(() => "");
  if (described) hints.push(described);
  const form = ((await page
    .evaluate(
      `(() => {
      var root = document.querySelector("main, [role='main']") || document.body;
      var nodes = root.querySelectorAll("input, textarea, select");
      var fields = [];
      var i;
      for (i = 0; i < nodes.length; i++) {
        var r = nodes[i].getBoundingClientRect();
        if (r.width > 2 && r.height > 2) fields.push(nodes[i]);
      }
      var readonly = 0;
      var disabled = 0;
      for (i = 0; i < fields.length; i++) {
        var typed = fields[i];
        if (typed.readOnly || typed.getAttribute("aria-readonly") === "true") readonly += 1;
        else if (typed.disabled || typed.getAttribute("aria-disabled") === "true") disabled += 1;
      }
      return { fields: fields.length, readonly: readonly, disabled: disabled };
    })()`,
    )
    .catch(() => ({ fields: 0, readonly: 0, disabled: 0 }))) as {
    fields: number;
    readonly: number;
    disabled: number;
  });
  if (form.fields > 0) {
    const live = form.fields - form.readonly - form.disabled;
    if (form.readonly >= form.fields / 2) {
      hints.push(`Most fields are readonly (${form.readonly} of ${form.fields}).`);
    } else if (form.disabled >= form.fields / 2) {
      hints.push(`Most fields are disabled (${form.disabled} of ${form.fields}).`);
    } else {
      hints.push(
        `The form is visible; ${live} of ${form.fields} fields look editable. Save itself is disabled (often until a change is registered), not hidden.`,
      );
    }
  }
  return hints;
}

export async function isPresentWidget(loc: PwLocator, page: Page): Promise<boolean> {
  return (await pickActable(loc, page)) !== undefined;
}

/**
 * Save stayed disabled: fire the form's submit path instead.
 * `requestSubmit` runs constraint validation; a raw `form.submit()` would skip it.
 */
export async function tryFallbackFormSubmit(page: Page, saveLoc: PwLocator): Promise<boolean> {
  const fromForm = await saveLoc
    .evaluate((el) => {
      const node = el as { closest(sel: string): { requestSubmit?: () => void; querySelector(sel: string): unknown } | null };
      const form = node.closest("form");
      if (!form) return false;
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
        return true;
      }
      const inner = form.querySelector('button[type="submit"], input[type="submit"]') as {
        disabled?: boolean;
        click(): void;
      } | null;
      if (inner && !inner.disabled) {
        inner.click();
        return true;
      }
      return false;
    })
    .catch(() => false);
  if (fromForm) return true;
  const submitBtn = page.locator('button[type="submit"]:not([disabled]), input[type="submit"]:not([disabled])');
  const n = await submitBtn.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const btn = submitBtn.nth(i);
    if (!(await btn.isVisible().catch(() => false))) continue;
    const ok = await btn
      .click({ timeout: 2_000 })
      .then(() => true)
      .catch(() => false);
    if (ok) return true;
  }
  const typedEnter = await saveLoc
    .evaluate((el) => {
      const node = el as { closest(sel: string): { querySelector(sel: string): { focus?: () => void } | null } | null };
      const form = node.closest("form");
      if (!form) return false;
      const input = form.querySelector(
        'input:not([type="hidden"]):not([type="submit"]):not([disabled]), textarea:not([disabled])',
      ) as { focus?: () => void } | null;
      if (!input?.focus) return false;
      input.focus();
      return true;
    })
    .catch(() => false);
  if (typedEnter) {
    await page.keyboard.press("Enter").catch(() => undefined);
    return true;
  }
  return false;
}

/** Visible and enabled, including below the fold. Does not scroll the page. */
export async function isLiveWidget(loc: PwLocator, page: Page): Promise<boolean> {
  const n = await loc.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    if (!(await isInteractable(el))) continue;
    if (await inViewport(el, page)) {
      if (!(await widgetIsCovered(el))) return true;
      continue;
    }
    return true;
  }
  return false;
}

export async function widgetWalkContext(
  loc: PwLocator,
  page: Page,
): Promise<{ inNav: boolean; inMain: boolean }> {
  const el = (await pickActable(loc, page)) ?? loc.first();
  return el
    .evaluate((node) => {
      const n = node as { closest(s: string): unknown };
      return {
        inNav: Boolean(n.closest("nav, [role='navigation']")),
        inMain: Boolean(n.closest("main, [role='main']")),
      };
    })
    .catch(() => ({ inNav: false, inMain: false }));
}
