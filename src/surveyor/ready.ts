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

export async function determineReady(page: Page): Promise<Locator> {
  const mainWithTestId = page.locator("main[data-testid], [role='main'][data-testid]");
  const mainMarked = await mainWithTestId.count();
  for (let i = 0; i < mainMarked; i++) {
    const el = mainWithTestId.nth(i);
    if (!(await el.isVisible())) continue;
    const value = (await el.getAttribute("data-testid"))?.trim();
    if (value) return { by: "testId", value };
  }

  const main = page.locator("main, [role='main']").first();
  if ((await page.locator("main, [role='main']").count()) > 0 && (await main.isVisible())) {
    const inner = main.locator("[data-testid]");
    const n = await inner.count();
    for (let i = 0; i < n; i++) {
      const el = inner.nth(i);
      if (!(await el.isVisible())) continue;
      const value = (await el.getAttribute("data-testid"))?.trim();
      if (value) return { by: "testId", value };
    }
  }

  const all = page.locator("[data-testid]");
  const n = await all.count();
  for (let i = 0; i < n; i++) {
    const el = all.nth(i);
    if (!(await el.isVisible())) continue;
    const value = (await el.getAttribute("data-testid"))?.trim();
    if (value) return { by: "testId", value };
  }

  const mainRole = await resolveCount(page, { by: "role", value: "main" });
  if (mainRole.count === 1) return { by: "role", value: "main" };

  throw new Error("cannot determine page.ready; add data-testid on main");
}

export async function createPageFromUrl(page: Page, usedIds: Set<string>): Promise<ModelPage> {
  const path = pathnameOf(page);
  const id = uniqueMint(pageIdFromPath(path), usedIds);
  const ready = await determineReady(page);
  return {
    id,
    path,
    params: [],
    ready,
    surfaces: [{ id: "page", kind: "page", fields: [], actions: [] }],
  };
}
