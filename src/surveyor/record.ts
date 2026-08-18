import { createHash } from "node:crypto";
import type { Page } from "playwright";
import { lastHtmlHash, persistQualitySnapshot } from "../persist/quality.js";
import { persistTestabilityPage } from "../persist/testability.js";
import type { TestabilityIssue } from "../schema/testability.js";
import { scanA11y } from "./a11y.js";
import { validateHtml } from "./html.js";
import { ledgerOrigin, pathnameOf } from "./ready.js";

export function pathOfPage(page: Page): string {
  try {
    return pathnameOf(page);
  } catch {
    return "/";
  }
}

function hashHtml(html: string): string {
  return createHash("sha1").update(html).digest("hex");
}

/** Persist locatability + HTML/a11y for the current page. Map file is never touched. */
export async function recordPageLedgers(
  configPath: string,
  page: Page,
  testability: { insufficient: boolean; issues: TestabilityIssue[] },
  opts?: { appOrigin?: string },
): Promise<void> {
  const path = pathOfPage(page);
  const origin = ledgerOrigin(page.url(), opts?.appOrigin);
  const foundAt = new Date().toISOString();
  persistTestabilityPage(configPath, {
    path,
    foundAt,
    insufficient: testability.insufficient,
    issues: testability.issues,
    ...(origin ? { origin } : {}),
  });
  let html: string;
  try {
    html = await page.content();
  } catch {
    return;
  }
  const htmlHash = hashHtml(html);
  if (lastHtmlHash(configPath, { path, ...(origin ? { origin } : {}) }) === htmlHash) return;
  try {
    const [htmlIssues, a11yIssues] = await Promise.all([validateHtml(html), scanA11y(page)]);
    persistQualitySnapshot(configPath, {
      path,
      foundAt,
      htmlHash,
      html: htmlIssues,
      a11y: a11yIssues,
      ...(origin ? { origin } : {}),
    });
  } catch {
    // scanners must not stall a walk
  }
}
