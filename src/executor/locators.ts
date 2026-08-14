import type { Locator as PwLocator, Page } from "playwright";
import type { Locator } from "../schema/locator.js";

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
