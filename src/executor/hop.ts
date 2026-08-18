import type { Fence } from "../schema/config.js";
import type { Page } from "../schema/page-model.js";
import {
  appOriginOf,
  isSameOriginPage,
  openHref,
  originOfHref,
  pathMatches,
} from "../surveyor/ready.js";
import { checkFence } from "./fence.js";

export type HopContext = {
  appUrl: string;
  fence?: Fence;
  intro?: readonly string[];
  currentHref?: string;
};

function startPathOf(appUrl: string): string {
  try {
    const path = new URL(appUrl).pathname;
    return path === "" ? "/" : path;
  } catch {
    return "/";
  }
}

export function pageHasWidgets(page: Pick<Page, "surfaces">): boolean {
  for (const surface of page.surfaces) {
    for (const w of [...surface.fields, ...surface.actions]) {
      if ((w.status ?? "ok") === "ok") return true;
    }
  }
  return false;
}

/** Pages the walker may `open`. Entry, empty, fenced, and off-origin pages are out. */
export function hoppablePages<T extends Page>(
  pages: readonly T[],
  hop: HopContext,
): T[] {
  const appOrigin = appOriginOf(hop.appUrl);
  const startPath = startPathOf(hop.appUrl);
  const currentPath = hop.currentHref
    ? (originOfHref(hop.currentHref)
        ? new URL(hop.currentHref).pathname || "/"
        : undefined)
    : undefined;
  const leftStart =
    Boolean(hop.intro && hop.intro.length > 0) &&
    currentPath !== undefined &&
    !pathMatches(startPath, currentPath);

  return pages.filter((page) => {
    if (!isSameOriginPage(page, appOrigin)) return false;
    if (checkFence(openHref(page, hop.appUrl), hop.fence) !== "ok") return false;
    if (page.entry) return false;
    if (leftStart && pathMatches(page.path, startPath)) return false;
    if (!pageHasWidgets(page)) return false;
    return true;
  });
}

export function hopContextOf(state: {
  config: { url: string; fence?: Fence; intro?: readonly string[] };
  page?: { url(): string };
}): HopContext {
  return {
    appUrl: state.config.url,
    fence: state.config.fence,
    intro: state.config.intro,
    ...(state.page ? { currentHref: state.page.url() } : {}),
  };
}
