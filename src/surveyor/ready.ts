import type { Page } from "playwright";
import type { Locator } from "../schema/locator.js";
import type { Page as ModelPage } from "../schema/page-model.js";
import { slug, uniqueMint } from "./ids.js";
import { resolveCount } from "./resolve.js";

export function pageIdFromPath(pathname: string): string {
  const trimmed = pathname.replace(/^\/+|\/+$/g, "");
  if (trimmed === "") return "home";
  return slug(trimmed);
}

export function pathnameOf(page: Page): string {
  const path = new URL(page.url()).pathname;
  return path === "" ? "/" : path;
}

export function originOfHref(href: string): string | undefined {
  try {
    return new URL(href).origin;
  } catch {
    return undefined;
  }
}

/** Stamp origin only when the live host is not the leash. */
export function ledgerOrigin(href: string, appOrigin?: string): string | undefined {
  const live = originOfHref(href);
  if (!live) return undefined;
  if (!appOrigin || live === appOrigin) return undefined;
  return live;
}

/** Origin the leash `url` belongs to. Pages without `origin` are assumed here. */
export function appOriginOf(appUrl: string): string {
  return new URL(appUrl).origin;
}

export function pageOriginOf(
  page: { origin?: string },
  appOrigin: string,
): string {
  return page.origin ?? appOrigin;
}

export function isSameOriginPage(
  page: { origin?: string },
  appOrigin: string,
): boolean {
  return pageOriginOf(page, appOrigin) === appOrigin;
}

/** `goto` target for `open`. Foreign pages keep their own origin. */
export function openHref(
  page: { path: string; origin?: string },
  appUrl: string,
): string {
  return new URL(page.path, page.origin ?? appUrl).href;
}

export function pageMatchesHref(
  page: { path: string; origin?: string },
  href: string,
  appOrigin: string,
): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  const pathname = url.pathname === "" ? "/" : url.pathname;
  if (!pathMatches(page.path, pathname)) return false;
  return pageOriginOf(page, appOrigin) === url.origin;
}

/** Resolve a map page for a live URL. Path + origin only. */
export function findPageForHref<T extends { path: string; origin?: string }>(
  pages: readonly T[],
  href: string,
  appOrigin: string,
): T | undefined {
  return pages.find((p) => pageMatchesHref(p, href, appOrigin));
}

export function pathMatches(template: string, pathname: string): boolean {
  const t = splitPath(template);
  const p = splitPath(pathname);
  if (t.length !== p.length) return false;
  for (let i = 0; i < t.length; i++) {
    const part = t[i] ?? "";
    if (part.startsWith(":")) continue;
    if (part !== (p[i] ?? "")) return false;
  }
  return true;
}

function splitPath(path: string): string[] {
  const trimmed = path.replace(/\/+$/, "");
  if (trimmed === "" || trimmed === "/") return [""];
  return trimmed.split("/");
}

async function unique(page: Page, loc: Locator): Promise<Locator | undefined> {
  return (await resolveCount(page, loc)).count === 1 ? loc : undefined;
}

async function firstVisibleTestId(page: Page, root?: ReturnType<Page["locator"]>): Promise<Locator | undefined> {
  const all = (root ?? page).locator("[data-testid]");
  const n = await all.count();
  for (let i = 0; i < n; i++) {
    const el = all.nth(i);
    if (!(await el.isVisible())) continue;
    const value = (await el.getAttribute("data-testid"))?.trim();
    if (value) return { by: "testId", value };
  }
  return undefined;
}

/** Prefer a unique landmark or heading. Test ids help but are not required. */
export async function determineReady(page: Page): Promise<Locator> {
  const marked = page.locator("main[data-testid], [role='main'][data-testid]");
  const markedN = await marked.count();
  for (let i = 0; i < markedN; i++) {
    const el = marked.nth(i);
    if (!(await el.isVisible())) continue;
    const value = (await el.getAttribute("data-testid"))?.trim();
    if (value) return { by: "testId", value };
  }

  const main = page.locator("main, [role='main']");
  if ((await main.count()) > 0 && (await main.first().isVisible())) {
    const inner = await firstVisibleTestId(page, main.first());
    if (inner) return inner;
  }

  const anyTestId = await firstVisibleTestId(page);
  if (anyTestId) return anyTestId;

  for (const role of [
    "main",
    "searchbox",
    "search",
    "banner",
    "navigation",
    "complementary",
    "contentinfo",
    "form",
    "article",
  ] as const) {
    const hit = await unique(page, { by: "role", value: role });
    if (hit) return hit;
  }

  const headings = page.locator("h1, h2, h3");
  const headingCount = await headings.count();
  for (let i = 0; i < headingCount; i++) {
    const el = headings.nth(i);
    if (!(await el.isVisible())) continue;
    const name = ((await el.innerText()) ?? "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    const loc = { by: "role" as const, value: "heading", name };
    if ((await unique(page, loc))) return loc;
  }

  const document = await unique(page, { by: "role", value: "document" });
  if (document) return document;
  const application = await unique(page, { by: "role", value: "application" });
  if (application) return application;

  return { by: "role", value: "document" };
}

export async function createPageFromUrl(
  page: Page,
  usedIds: Set<string>,
  appOrigin?: string,
  opts?: { entry?: boolean },
): Promise<ModelPage> {
  const path = pathnameOf(page);
  const id = uniqueMint(pageIdFromPath(path), usedIds);
  const ready = await determineReady(page);
  const liveOrigin = originOfHref(page.url());
  const origin =
    appOrigin && liveOrigin && liveOrigin !== appOrigin ? liveOrigin : undefined;
  return {
    id,
    path,
    ...(origin ? { origin } : {}),
    ...(opts?.entry ? { entry: true } : {}),
    params: [],
    ready,
    surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
  };
}
