import { createHash } from "node:crypto";
import type { Page } from "playwright";
import { lastQualityPage, persistQualitySnapshot } from "../persist/quality.js";
import { persistTestabilityPage } from "../persist/testability.js";
import type { SeoConfig } from "../schema/config.js";
import { qualityIssuesEqual, type QualityIssue } from "../schema/quality.js";
import type { TestabilityIssue } from "../schema/testability.js";
import { scanA11y } from "./a11y.js";
import { validateHtml } from "./html.js";
import { ledgerOrigin, pathnameOf } from "./ready.js";
import { scanSeo, seoIsPrivate } from "./seo.js";

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
  opts?: { appOrigin?: string; seo?: SeoConfig },
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
  const key = { path, ...(origin ? { origin } : {}) };
  const scanPublicMeta = !seoIsPrivate(path, opts?.seo);
  const prev = lastQualityPage(configPath, key);
  if (prev?.htmlHash === htmlHash) {
    try {
      const seo = await seoForHashHit(page, scanPublicMeta, prev.seo);
      if (seo === undefined) return;
      persistQualitySnapshot(configPath, {
        path,
        foundAt,
        htmlHash,
        html: prev.html,
        a11y: prev.a11y,
        seo,
        ...(origin ? { origin } : {}),
      });
    } catch {
      // scanners must not stall a walk
    }
    return;
  }
  try {
    const scanned = scanPublicMeta ? await scanSeo(page) : [];
    const seoIssues = scanned === undefined ? (prev?.seo ?? []) : scanned;
    const [htmlIssues, a11yIssues] = await Promise.all([validateHtml(html), scanA11y(page)]);
    persistQualitySnapshot(configPath, {
      path,
      foundAt,
      htmlHash,
      html: htmlIssues,
      a11y: a11yIssues,
      seo: seoIssues,
      ...(origin ? { origin } : {}),
    });
  } catch {
    // scanners must not stall a walk
  }
}

/** `undefined` = keep disk as-is (failed scan or unchanged). */
async function seoForHashHit(
  page: Page,
  scanPublicMeta: boolean,
  prevSeo: QualityIssue[] | undefined,
): Promise<QualityIssue[] | undefined> {
  if (!scanPublicMeta) return (prevSeo ?? []).length > 0 ? [] : undefined;
  const scanned = await scanSeo(page);
  if (scanned === undefined) return undefined;
  if (qualityIssuesEqual(prevSeo, scanned)) return undefined;
  return scanned;
}
