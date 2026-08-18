import type { Locator as PwLocator, Page } from "playwright";
import type { Locator } from "../schema/locator.js";
import { toPlaywrightLocator } from "../executor/locators.js";

export async function resolveCount(
  root: Page | PwLocator,
  loc: Locator,
): Promise<{ status: "ok" | "unresolved"; count: number }> {
  const count = await toPlaywrightLocator(root, loc).count();
  return { status: count >= 1 ? "ok" : "unresolved", count };
}
