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
  switch (loc.by) {
    case "testId":
      return root.getByTestId(loc.value);
    case "name":
      return root.locator(`[name="${cssEscape(loc.value)}"]`);
    case "role":
      return root.getByRole(
        loc.value as AriaRole,
        loc.name ? { name: loc.name, exact: true } : {},
      );
    case "label":
      return root.getByLabel(loc.value, { exact: true });
  }
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

export type ActableMiss = "missing" | "hidden" | "disabled" | "tiny" | "offscreen";

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

async function isPresentOne(el: PwLocator, page: Page): Promise<boolean> {
  if (!(await el.isVisible().catch(() => false))) return false;
  if (await isDisabled(el)) return false;
  const box = await el.boundingBox().catch(() => null);
  if (!box || box.width < 2 || box.height < 2) return false;
  const vp = page.viewportSize();
  if (!vp) return true;
  return !isOffscreen(box, vp);
}

async function pickActableNow(loc: PwLocator, page: Page): Promise<PwLocator | undefined> {
  const n = await loc.count().catch(() => 0);
  let covered: PwLocator | undefined;
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    if (!(await isPresentOne(el, page))) continue;
    if (!(await widgetIsCovered(el))) return el;
    covered ??= el;
  }
  return covered;
}

/**
 * First match that is visible, enabled, and on-screen.
 * Duplicates are allowed — prefer an uncovered hit.
 * Clicks/fills pass timeoutMs so a disabled login button can enable.
 */
export async function pickActable(
  loc: PwLocator,
  page: Page,
  opts?: { timeoutMs?: number },
): Promise<PwLocator | undefined> {
  const timeoutMs = opts?.timeoutMs ?? 0;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = await pickActableNow(loc, page);
    if (hit) return hit;
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
    const vp = page.viewportSize();
    if (vp && isOffscreen(box, vp)) reasons.add("offscreen");
  }
  if (reasons.has("disabled")) return "disabled";
  if (reasons.has("offscreen")) return "offscreen";
  if (reasons.has("tiny")) return "tiny";
  return "hidden";
}

export function actableMissMessage(key: string, miss: ActableMiss): string {
  switch (miss) {
    case "missing":
      return `${key} was not found`;
    case "disabled":
      return `${key} is disabled`;
    case "tiny":
      return `${key} is too small to click`;
    case "offscreen":
      return `${key} is off-screen`;
    default:
      return `${key} is not visible`;
  }
}

export async function isPresentWidget(loc: PwLocator, page: Page): Promise<boolean> {
  return (await pickActable(loc, page)) !== undefined;
}

/** At least one present match is not covered. */
export async function isLiveWidget(loc: PwLocator, page: Page): Promise<boolean> {
  const n = await loc.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    if (!(await isPresentOne(el, page))) continue;
    if (!(await widgetIsCovered(el))) return true;
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
