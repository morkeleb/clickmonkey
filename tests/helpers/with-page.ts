import type { Page } from "playwright";
import { pathToFileURL } from "node:url";
import { withRun } from "../../src/executor/session.js";

export async function withPage<T>(
  htmlPath: string,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  return withRun({}, async ({ page }) => {
    await page.goto(pathToFileURL(htmlPath).href);
    return fn(page);
  });
}
