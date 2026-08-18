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

async function isPresentOne(el: PwLocator, page: Page): Promise<boolean> {
  if (!(await el.isVisible().catch(() => false))) return false;
  const enabled = await el
    .evaluate((node) => {
      const typed = node as { disabled?: boolean; getAttribute(name: string): string | null };
      if (typed.disabled) return false;
      if (typed.getAttribute("aria-disabled") === "true") return false;
      return true;
    })
    .catch(() => false);
  if (!enabled) return false;
  const box = await el.boundingBox().catch(() => null);
  if (!box || box.width < 2 || box.height < 2) return false;
  const vp = page.viewportSize();
  if (!vp) return true;
  if (box.x + box.width < 0 || box.y + box.height < 0) return false;
  if (box.x > vp.width || box.y > vp.height) return false;
  return true;
}

/**
 * First match that is visible, enabled, and on-screen.
 * Duplicates are allowed — prefer an uncovered hit.
 */
export async function pickActable(loc: PwLocator, page: Page): Promise<PwLocator | undefined> {
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

export async function widgetInNav(loc: PwLocator, page: Page): Promise<boolean> {
  const el = (await pickActable(loc, page)) ?? loc.first();
  return el
    .evaluate((node) => Boolean((node as { closest(s: string): unknown }).closest("nav, [role='navigation']")))
    .catch(() => false);
}
