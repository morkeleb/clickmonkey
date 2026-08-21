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
import { metaFromHtml, scanSeoHtml, seoIsPrivate } from "./seo.js";

export function pathOfPage(page: Page): string {
  try {
    return pathnameOf(page);
  } catch {
    return "/";
  }
}

export function hashHtml(html: string): string {
  return createHash("sha1").update(html).digest("hex");
}

export async function qualityFromHtml(
  html: string,
  pageUrl: string,
  scanSeo: boolean,
): Promise<{ html: QualityIssue[]; seo: QualityIssue[] }> {
  const [htmlIssues, seoIssues] = await Promise.all([
    validateHtml(html),
    scanSeo ? Promise.resolve(scanSeoHtml(html, pageUrl)) : Promise.resolve([]),
  ]);
  return { html: htmlIssues, seo: seoIssues };
}

/** Persist locatability + HTML/a11y for the current page. Map file is never touched. */
export async function recordPageLedgers(
  configPath: string,
  page: Page,
  testability: { insufficient: boolean; issues: TestabilityIssue[] },
  opts?: {
    appOrigin?: string;
    seo?: SeoConfig;
    path?: string;
    outDir?: string;
    html?: string;
    href?: string;
    skipQuality?: boolean;
  },
): Promise<void> {
  const livePath = pathOfPage(page);
  const path = opts?.path ?? livePath;
  const href = opts?.href ?? page.url();
  const origin = ledgerOrigin(href, opts?.appOrigin);
  const foundAt = new Date().toISOString();
  persistTestabilityPage(
    configPath,
    {
      path,
      foundAt,
      insufficient: testability.insufficient,
      issues: testability.issues,
      ...(origin ? { origin } : {}),
    },
    opts?.outDir,
  );
  if (opts?.skipQuality) return;
  let html = opts?.html;
  if (html === undefined) {
    try {
      html = await page.content();
    } catch {
      return;
    }
  }
  try {
    const htmlHash = hashHtml(html);
    const key = { path, ...(origin ? { origin } : {}) };
    const prev = lastQualityPage(configPath, key, opts?.outDir);
    if (prev?.htmlHash === htmlHash) {
      await persistQualityFromHtml(configPath, {
        html,
        href,
        path,
        livePath,
        origin,
        seo: opts?.seo,
        outDir: opts?.outDir,
        a11y: prev.a11y,
      });
      return;
    }
    const scanPublicMeta = !seoIsPrivate(path, opts?.seo);
    const [markup, a11y] = await Promise.all([
      qualityFromHtml(html, href, scanPublicMeta),
      scanA11y(page),
    ]);
    await persistQualityFromHtml(configPath, {
      html,
      href,
      path,
      livePath,
      origin,
      seo: opts?.seo,
      outDir: opts?.outDir,
      a11y,
      htmlIssues: markup.html,
      seoIssues: markup.seo,
    });
  } catch {
    // scanners must not stall a walk
  }
}

/** Write html-validate / SEO / axe rows from one HTML snapshot. Axe results are passed in. */
export async function persistQualityFromHtml(
  configPath: string,
  opts: {
    html: string;
    href: string;
    path: string;
    livePath: string;
    origin?: string;
    seo?: SeoConfig;
    outDir?: string;
    a11y?: QualityIssue[];
    htmlIssues?: QualityIssue[];
    seoIssues?: QualityIssue[];
    title?: string;
    /** Axe did not return a result — persist html/seo but do not skip the next scan. */
    omitHtmlHash?: boolean;
  },
): Promise<void> {
  const htmlHash = hashHtml(opts.html);
  const key = { path: opts.path, ...(opts.origin ? { origin: opts.origin } : {}) };
  const scanPublicMeta = !seoIsPrivate(opts.path, opts.seo);
  const prev = lastQualityPage(configPath, key, opts.outDir);
  const title =
    (opts.title ?? metaFromHtml(opts.html).title).replace(/\s+/g, " ").trim() || prev?.title;
  const foundAt = new Date().toISOString();
  if (prev?.htmlHash === htmlHash && opts.htmlIssues === undefined) {
    const seo = seoForHashHit(opts.html, opts.href, scanPublicMeta, prev.seo);
    if (seo === undefined && !title) return;
    persistQualitySnapshot(
      configPath,
      {
        path: opts.path,
        foundAt,
        htmlHash,
        html: prev.html,
        a11y: prev.a11y,
        seo: seo ?? prev.seo ?? [],
        ...(opts.origin ? { origin: opts.origin } : {}),
        ...(title ? { title } : {}),
        ...(title ? { titleInstance: { path: opts.livePath, title } } : {}),
      },
      opts.outDir,
    );
    return;
  }
  const scanned =
    opts.htmlIssues && opts.seoIssues
      ? { html: opts.htmlIssues, seo: opts.seoIssues }
      : await qualityFromHtml(opts.html, opts.href, scanPublicMeta);
  persistQualitySnapshot(
    configPath,
    {
      path: opts.path,
      foundAt,
      html: scanned.html,
      a11y: opts.a11y ?? prev?.a11y ?? [],
      seo: scanned.seo,
      ...(opts.omitHtmlHash ? {} : { htmlHash }),
      ...(opts.origin ? { origin: opts.origin } : {}),
      ...(title ? { title } : {}),
      ...(title ? { titleInstance: { path: opts.livePath, title } } : {}),
    },
    opts.outDir,
  );
}

/** `undefined` = keep disk as-is (failed scan or unchanged). */
function seoForHashHit(
  html: string,
  pageUrl: string,
  scanPublicMeta: boolean,
  prevSeo: QualityIssue[] | undefined,
): QualityIssue[] | undefined {
  if (!scanPublicMeta) return (prevSeo ?? []).length > 0 ? [] : undefined;
  const scanned = scanSeoHtml(html, pageUrl);
  if (qualityIssuesEqual(prevSeo, scanned)) return undefined;
  return scanned;
}
