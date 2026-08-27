import type { Locator as PwLocator, Page } from "playwright";
import type { Locator } from "../schema/locator.js";
import type { Page as ModelPage, Surface } from "../schema/page-model.js";
import { toPlaywrightLocator } from "../executor/locators.js";
import { slug, uniqueMint, stableAccName, isActiveTabsSurfaceId } from "./ids.js";

export { isActiveTabsSurfaceId } from "./ids.js";

const DIALOG_UNION = "dialog, [role='dialog'], [aria-modal='true']";

export interface BoundSurface {
  surfaceId: string;
  kind: "page" | "dialog";
  locator?: Locator;
}

export interface BoundSurfaces {
  pageSurfaceId: string;
  stack: string[];
  entries: BoundSurface[];
}

export function pageSurfaceIdOf(modelPage: ModelPage): string {
  return modelPage.surfaces.find((s) => s.kind === "page")?.id ?? "page";
}

type BrowserEl = {
  innerText: string;
  getAttribute(name: string): string | null;
};

type DialogRead = {
  testId: string;
  accName: string;
};

function readDialog(el: BrowserEl): DialogRead {
  const doc = (globalThis as unknown as {
    document: { getElementById(id: string): BrowserEl | null };
  }).document;
  let accName = "";
  const aria = el.getAttribute("aria-label");
  if (aria && aria.trim()) {
    accName = aria.trim().slice(0, 80);
  } else {
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => doc.getElementById(id)?.innerText ?? "")
        .join(" ")
        .trim();
      if (text) accName = text.slice(0, 80);
    }
  }
  if (!accName) {
    const text = (el.innerText ?? "").trim();
    if (text) accName = text.slice(0, 80);
  }
  return {
    testId: el.getAttribute("data-testid")?.trim() ?? "",
    accName,
  };
}

export async function listVisibleDialogs(page: Page): Promise<PwLocator[]> {
  const union = page.locator(DIALOG_UNION);
  const n = await union.count();
  const out: PwLocator[] = [];
  for (let i = 0; i < n; i++) {
    const loc = union.nth(i);
    if (await loc.isVisible()) out.push(loc);
  }
  return out;
}

async function locatorHits(page: Page, loc: Locator, el: PwLocator): Promise<boolean> {
  const pw = toPlaywrightLocator(page, loc);
  if ((await pw.count()) !== 1) return false;
  return (await el.and(pw).count()) === 1;
}

function isActiveTabsName(name: string | undefined): boolean {
  return Boolean(name && stableAccName(name) === "Active tabs");
}

function canonicalActiveTabsLocator(): Locator {
  return { by: "role", value: "dialog", name: "Active tabs", nameExact: false };
}

export function pickActiveTabsSurface<T extends { id: string; locator?: { name?: string } }>(
  surfaces: T[],
  claimed: Set<string>,
): T | undefined {
  const open = surfaces.filter((s) => {
    if (claimed.has(s.id)) return false;
    if (s.id === "active_tabs" || /^active_tabs_/.test(s.id)) return true;
    return isActiveTabsName(s.locator?.name);
  });
  return (
    open.find((s) => s.id === "active_tabs") ??
    open.find((s) => /^active_tabs_/.test(s.id)) ??
    open[0]
  );
}

export function mintDialog(
  info: { testId: string; accName: string },
  used: Set<string>,
): { surfaceId: string; locator: Locator } {
  if (isActiveTabsName(info.accName)) {
    used.add("active_tabs");
    return {
      surfaceId: "active_tabs",
      locator: canonicalActiveTabsLocator(),
    };
  }
  if (info.accName) {
    return {
      surfaceId: uniqueMint(slug(info.accName), used),
      locator: { by: "role", value: "dialog", name: info.accName },
    };
  }
  if (info.testId) {
    return {
      surfaceId: uniqueMint(slug(info.testId), used),
      locator: { by: "testId", value: info.testId },
    };
  }
  return {
    surfaceId: uniqueMint("dialog", used),
    locator: { by: "role", value: "dialog" },
  };
}

export async function bindSurfaces(
  page: Page,
  modelPage: ModelPage,
  lastAction?: { surface: string; id: string; opens?: string },
): Promise<BoundSurfaces> {
  const pageSurfaceId = pageSurfaceIdOf(modelPage);
  const pageSurface = modelPage.surfaces.find((s) => s.id === pageSurfaceId);
  const dialogSurfaces = modelPage.surfaces.filter((s) => s.kind === "dialog");
  const used = new Set<string>([pageSurfaceId, modelPage.id, ...modelPage.surfaces.map((s) => s.id)]);
  const claimed = new Set<string>();

  const visible = await listVisibleDialogs(page);
  const dialogs: BoundSurface[] = [];

  const hintId =
    lastAction?.opens && modelPage.surfaces.some((s) => s.id === lastAction.opens)
      ? lastAction.opens
      : undefined;

  for (let i = 0; i < visible.length; i++) {
    const el = visible[i];
    if (!el) continue;
    const isCurrent = i === visible.length - 1;
    const info = await el.evaluate(readDialog);

    if (hintId && isCurrent && !claimed.has(hintId)) {
      const existing = dialogSurfaces.find((s) => s.id === hintId);
      if (existing && isActiveTabsName(info.accName)) {
        existing.locator = canonicalActiveTabsLocator();
      }
      dialogs.push({
        surfaceId: hintId,
        kind: "dialog",
        locator: existing?.locator ?? mintDialog(info, used).locator,
      });
      claimed.add(hintId);
      continue;
    }

    let matched: Surface | undefined;
    for (const s of dialogSurfaces) {
      if (claimed.has(s.id) || !s.locator) continue;
      if (await locatorHits(page, s.locator, el)) {
        matched = s;
        break;
      }
    }
    if (!matched && isActiveTabsName(info.accName)) {
      matched = pickActiveTabsSurface(dialogSurfaces, claimed);
    }
    if (matched) {
      if (isActiveTabsName(info.accName)) {
        matched.locator = canonicalActiveTabsLocator();
      }
      dialogs.push({
        surfaceId: matched.id,
        kind: "dialog",
        locator: matched.locator,
      });
      claimed.add(matched.id);
      continue;
    }

    const minted = mintDialog(info, used);
    dialogs.push({ surfaceId: minted.surfaceId, kind: "dialog", locator: minted.locator });
    claimed.add(minted.surfaceId);
  }

  const stack = [pageSurfaceId, ...dialogs.map((d) => d.surfaceId)];
  return {
    pageSurfaceId,
    stack,
    entries: [
      { surfaceId: pageSurfaceId, kind: "page", locator: pageSurface?.locator },
      ...dialogs,
    ],
  };
}

/** One Active tabs dialog and one opener; drop count-suffixed copies. */
export function foldActiveTabChrome(page: ModelPage): boolean {
  let changed = false;
  const extras = page.surfaces.filter((s) => s.kind === "dialog" && isActiveTabsSurfaceId(s.id));
  if (extras.length > 0) {
    const keep = extras.find((s) => s.id === "active_tabs") ?? extras[0]!;
    if (keep.id !== "active_tabs") {
      keep.id = "active_tabs";
      changed = true;
    }
    keep.locator = canonicalActiveTabsLocator();
    const drop = new Set(extras.filter((s) => s !== keep).map((s) => s.id));
    if (drop.size > 0) {
      page.surfaces = page.surfaces.filter((s) => !drop.has(s.id));
      for (const surface of page.surfaces) {
        for (const action of surface.actions) {
          if (action.opens && (drop.has(action.opens) || isActiveTabsSurfaceId(action.opens))) {
            action.opens = "active_tabs";
          }
        }
      }
      changed = true;
    }
  }

  for (const surface of page.surfaces) {
    const tabBtns = surface.actions.filter((a) => a.id === "button_active_tabs" || /^button_active_tabs_/.test(a.id));
    if (tabBtns.length <= 1) continue;
    const keep = tabBtns.find((a) => a.id === "button_active_tabs") ?? tabBtns[0]!;
    keep.id = "button_active_tabs";
    keep.name = "Active tabs";
    keep.nameExact = false;
    keep.opens = "active_tabs";
    const drop = new Set(tabBtns.filter((a) => a !== keep).map((a) => a.id));
    surface.actions = surface.actions.filter((a) => !drop.has(a.id));
    changed = true;
  }
  return changed;
}
