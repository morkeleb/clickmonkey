import type { Page } from "playwright";

/** Bounded wait so an infinite spinner does not stall the walk. */
export const LOADING_WAIT_MS = 2500;

/**
 * Sitemap/VLM captions of a transient frame. A heading plus cards/table/form
 * is not this — even if a dropdown is open.
 */
export function blurbLooksLikeLoading(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (
    /\b(loading screen|splash screen|skeleton screen|skeleton (?:loader|placeholder|ui)|still loading|waits? for (?:content|data|the page)(?: to (?:appear|load))?|please wait)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  const transient = /\b(spinner|skeleton|splash|waits? for|please wait|to appear|loading indicator)\b/i.test(
    t,
  );
  if (/^loading\b/i.test(t)) {
    const realPane = /\b(form|table|list|dashboard|settings|detail|wizard|login|report|cards?)\b/i.test(
      t,
    );
    if (!realPane) return true;
    return transient;
  }
  if (
    t.length < 140 &&
    /\b(spinner|loading indicator|loading spinner)\b/i.test(t) &&
    !/\b(form|table|list|dashboard|settings|detail)\b/i.test(t)
  ) {
    return true;
  }
  return false;
}

/** Main-pane copy that is only a wait, not an empty-state message. */
export function textIsLoadingPlaceholder(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (/^(loading|please wait|loading[\s.…]+)[\s.…!]*$/i.test(t)) return true;
  if (t.length <= 48 && /^(loading|please wait)\b/i.test(t)) return true;
  return false;
}

function stripMarkup(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sliceMain(html: string): string | undefined {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (main?.[1] !== undefined) return main[1];
  const role = html.match(
    /<([a-z][a-z0-9]*)\b[^>]*\brole\s*=\s*(["'])main\2[^>]*>([\s\S]*?)<\/\1>/i,
  );
  return role?.[3];
}

function landmarkIsBusy(html: string): boolean {
  if (/<(?:html|body|main)\b[^>]*\baria-busy\s*=\s*(["']?)true\1/i.test(html)) return true;
  if (/<[a-z][a-z0-9]*\b[^>]*\brole\s*=\s*(["'])main\1[^>]*\baria-busy\s*=\s*(["']?)true\2/i.test(html)) {
    return true;
  }
  return /<[a-z][a-z0-9]*\b[^>]*\baria-busy\s*=\s*(["']?)true\1[^>]*\brole\s*=\s*(["'])main\2/i.test(
    html,
  );
}

function hasLoadingChrome(html: string): boolean {
  if (/\brole\s*=\s*(["'])progressbar\1/i.test(html)) return true;
  if (/\b(?:aria-label|title)\s*=\s*(["'])[^"']*\bloading\b[^"']*\1/i.test(html)) return true;
  return /\bclass\s*=\s*["'][^"']*\b(?:spinner|skeleton|animate-pulse|loading)\b/i.test(html);
}

/** True when the MAIN pane is still a spinner/skeleton — sidenav chrome does not count. */
export function htmlLooksLikeLoading(html: string): boolean {
  if (!html.trim()) return false;
  if (landmarkIsBusy(html)) return true;
  const main = sliceMain(html);
  const chunk = main ?? html;
  const text = stripMarkup(chunk);
  if (textIsLoadingPlaceholder(text)) return true;
  if (main !== undefined && hasLoadingChrome(main) && text.length < 80) return true;
  return false;
}

type LoadingEl = {
  getAttribute(name: string): string | null;
  innerText?: string;
  querySelector(sel: string): LoadingEl | null;
  ownerDocument: {
    documentElement: LoadingEl;
    body: LoadingEl | null;
    querySelector(sel: string): LoadingEl | null;
  };
};

/**
 * Browser-side. Closure-free for locator.evaluate.
 * Argument is the `<html>` element.
 */
export function readPageLoading(html: LoadingEl): boolean {
  const doc = html.ownerDocument;
  if (doc.documentElement.getAttribute("aria-busy") === "true") return true;
  if (doc.body && doc.body.getAttribute("aria-busy") === "true") return true;
  const main = doc.querySelector("main, [role='main']") ?? doc.body;
  if (!main) return false;
  if (main.getAttribute("aria-busy") === "true") return true;
  const text = (main.innerText ?? "").replace(/\s+/g, " ").trim();
  if (/^(loading|please wait|loading[\s.…]+)[\s.…!]*$/i.test(text)) return true;
  if (text.length <= 48 && /^(loading|please wait)\b/i.test(text)) return true;
  if (text.length >= 80) return false;
  return Boolean(
    main.querySelector(
      '[role="progressbar"], [aria-label*="loading" i], [class*="spinner" i], [class*="skeleton" i], [class*="animate-pulse" i]',
    ),
  );
}

export async function pageLooksLikeLoading(page: Page): Promise<boolean> {
  const root = page.locator("html");
  if ((await root.count().catch(() => 0)) === 0) return false;
  return root.first().evaluate(readPageLoading).catch(() => false);
}

/** Wait until the main pane is not a loading frame. True if it was still loading when the budget ran out. */
export async function waitOutLoading(page: Page, timeoutMs = LOADING_WAIT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await pageLooksLikeLoading(page))) return false;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await page.waitForTimeout(Math.min(150, remaining));
  }
  return pageLooksLikeLoading(page);
}
