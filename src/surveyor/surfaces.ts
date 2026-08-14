import type { Locator as PwLocator, Page } from "playwright";
import type { Locator } from "../schema/locator.js";
import type { Page as ModelPage, Surface } from "../schema/page-model.js";
import { toPlaywrightLocator } from "../executor/locators.js";
import { slug, uniqueMint } from "./ids.js";

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

function mintDialog(
  info: DialogRead,
  used: Set<string>,
): { surfaceId: string; locator: Locator } {
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

    if (hintId && isCurrent && !claimed.has(hintId)) {
      const existing = dialogSurfaces.find((s) => s.id === hintId);
      const info = await el.evaluate(readDialog);
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
    if (matched) {
      dialogs.push({
        surfaceId: matched.id,
        kind: "dialog",
        locator: matched.locator,
      });
      claimed.add(matched.id);
      continue;
    }

    const minted = mintDialog(await el.evaluate(readDialog), used);
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
