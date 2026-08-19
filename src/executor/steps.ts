import type { Page } from "playwright";
import type { FindingKind } from "../schema/finding.js";
import { locatorOf, type Locator } from "../schema/locator.js";
import { readyKey, widgetKey } from "../schema/refs.js";
import {
  findPageForHref,
  openHref,
  originOfHref,
  pathMatches,
} from "../surveyor/ready.js";
import { checkFence } from "./fence.js";
import { oneLineBug } from "../schema/dsl.js";
import type { Step } from "../schema/log.js";
import type { Action, Field, Page as PageDef, Surface, Widget } from "../schema/page-model.js";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { slug } from "../surveyor/ids.js";
import {
  ACTABLE_WAIT_MS,
  actableMissMessage,
  explainActableMiss,
  pickActable,
  toPlaywrightLocator,
  widgetLocator,
} from "./locators.js";
import type { RunState } from "./run.js";
import { resolveSecretAsync } from "./secrets.js";
import { isPotentialWrite } from "./write-policy.js";

export type StepFailure = {
  kind: FindingKind;
  message: string;
  widgetRef?: string;
  url?: string;
};

export { locatorOf as widgetLocator } from "../schema/locator.js";
export { readyKey, widgetKey } from "../schema/refs.js";

export function findPage(state: RunState, pageId = state.pageId): PageDef | undefined {
  return state.model.pages.find((p) => p.id === pageId);
}

export function findSurface(state: RunState, surfaceId: string): Surface | undefined {
  const current = findPage(state);
  const fromCurrent = current?.surfaces.find((s) => s.id === surfaceId);
  if (fromCurrent) return fromCurrent;
  for (const page of state.model.pages) {
    const s = page.surfaces.find((x) => x.id === surfaceId);
    if (s) return s;
  }
  return undefined;
}

export function findWidget(
  state: RunState,
  surfaceId: string,
  id: string,
): { surface: Surface; widget: Widget } | undefined {
  const surface = findSurface(state, surfaceId);
  if (!surface) return undefined;
  const widget =
    surface.fields.find((f) => f.id === id) ?? surface.actions.find((a) => a.id === id);
  if (!widget) return undefined;
  return { surface, widget };
}

export function isField(w: Widget): w is Field {
  return "type" in w;
}

function locatorFor(state: RunState, key: string, widget: { by: Locator["by"]; value: string; name?: string }): Locator {
  if (state.replay && state.usedLocators[key]) return state.usedLocators[key];
  return locatorOf(widget);
}

export function recordLocator(state: RunState, key: string, loc: Locator): void {
  state.usedLocators[key] = loc;
  state.log.usedLocators[key] = loc;
}

export function requireActable(
  state: RunState,
  surfaceId: string,
  id: string,
): { ok: true; surface: Surface; widget: Widget; locator: Locator; key: string } | { ok: false; failure: StepFailure } {
  const found = findWidget(state, surfaceId, id);
  const ref = widgetKey(surfaceId, id);
  if (!found) {
    return {
      ok: false,
      failure: { kind: "unknownId", message: `unknown id ${ref}`, widgetRef: ref },
    };
  }
  const key = ref;
  const locator = locatorFor(state, key, found.widget);
  if (!state.replay) {
    if (found.widget.status === "unresolved") {
      return {
        ok: false,
        failure: { kind: "unresolvedId", message: `unresolved id ${ref}`, widgetRef: ref },
      };
    }
    if (found.widget.status === "drift") {
      return {
        ok: false,
        failure: { kind: "driftId", message: `drift id ${ref}`, widgetRef: ref },
      };
    }
  }
  return { ok: true, surface: found.surface, widget: found.widget, locator, key };
}

export { pathMatches as pathnameMatches } from "../surveyor/ready.js";

export function syncPageFromUrl(state: RunState): void {
  const href = state.page.url();
  const appOrigin = originOfHref(state.config.url);
  if (!appOrigin) return;
  const matched = findPageForHref(state.model.pages, href, appOrigin);
  if (!matched || matched.id === state.pageId) return;
  state.pageId = matched.id;
  const pageSurface = matched.surfaces.find((s) => s.kind === "page");
  state.surfaceStack = [pageSurface?.id ?? matched.id];
}

export async function syncSurfaceStack(state: RunState): Promise<void> {
  while (state.surfaceStack.length > 1) {
    const top = state.surfaceStack[state.surfaceStack.length - 1];
    if (!top) break;
    const surface = findSurface(state, top);
    if (!surface || surface.kind === "page") break;
    if (!surface.locator) break;
    const visible = await toPlaywrightLocator(state.page, surface.locator)
      .isVisible()
      .catch(() => false);
    if (visible) break;
    state.surfaceStack.pop();
  }
}

async function domInputType(pw: ReturnType<typeof widgetLocator>): Promise<string | undefined> {
  return pw
    .evaluate((el) => {
      const type = (el as { type?: unknown }).type;
      return typeof type === "string" ? type : undefined;
    })
    .catch(() => undefined);
}

async function fieldEmpty(pw: ReturnType<typeof widgetLocator>, field: Field): Promise<boolean> {
  if (field.type === "checkbox") {
    return !(await pw.isChecked().catch(() => false));
  }
  const value = await pw.inputValue().catch(() => "");
  return value.trim() === "";
}

async function writePolicyBlocked(
  state: RunState,
  surface: Surface,
  action: Action,
  loc: Locator,
): Promise<StepFailure | undefined> {
  if (state.config.writePolicy !== "validationOnly") return undefined;
  const actionEl = await pickActable(widgetLocator(state.page, surface, loc), state.page);
  const inputType = actionEl ? await domInputType(actionEl) : undefined;
  if (!isPotentialWrite(action, inputType)) return undefined;
  const required = surface.fields.filter((f) => f.required && (f.status ?? "ok") === "ok");
  if (required.length === 0) return undefined;
  for (const field of required) {
    const key = widgetKey(surface.id, field.id);
    const fieldLoc = locatorFor(state, key, field);
    const fieldEl = await pickActable(widgetLocator(state.page, surface, fieldLoc), state.page);
    if (!fieldEl || (await fieldEmpty(fieldEl, field))) return undefined;
  }
  return {
    kind: "writePolicyBlocked",
    message: `write policy blocked ${surface.id}.${action.id}: required fields are filled`,
    widgetRef: widgetKey(surface.id, action.id),
  };
}

async function performOpen(state: RunState, pageId: string): Promise<StepFailure | undefined> {
  const pageDef = findPage(state, pageId);
  if (!pageDef) {
    return { kind: "unknownId", message: `unknown page ${pageId}`, widgetRef: `page:${pageId}` };
  }
  const target = openHref(pageDef, state.config.url);
  if (!state.inIntro && checkFence(target, state.config.fence) !== "ok") {
    return {
      kind: "fenceViolation",
      message: `open ${pageId} is outside the fence: ${target}`,
      url: target,
    };
  }
  await state.page.goto(target, { waitUntil: "domcontentloaded" });
  const ready = locatorFor(state, readyKey(pageId), pageDef.ready);
  await toPlaywrightLocator(state.page, ready).waitFor({ state: "attached" });
  recordLocator(state, readyKey(pageId), ready);
  state.pageId = pageDef.id;
  const pageSurface = pageDef.surfaces.find((s) => s.kind === "page");
  state.surfaceStack = [pageSurface?.id ?? pageDef.id];
  return undefined;
}

async function performClick(
  state: RunState,
  surfaceId: string,
  id: string,
): Promise<StepFailure | undefined> {
  const actable = requireActable(state, surfaceId, id);
  if (!actable.ok) return actable.failure;
  const raw = widgetLocator(state.page, actable.surface, actable.locator);
  const pw = await pickActable(raw, state.page, { timeoutMs: ACTABLE_WAIT_MS });
  if (!pw) {
    return {
      kind: "expectFailed",
      message: actableMissMessage(actable.key, await explainActableMiss(raw, state.page)),
      widgetRef: actable.key,
    };
  }
  if (!isField(actable.widget) && !state.inIntro) {
    const blocked = await writePolicyBlocked(state, actable.surface, actable.widget, actable.locator);
    if (blocked) {
      recordLocator(state, actable.key, actable.locator);
      return blocked;
    }
  }
  recordLocator(state, actable.key, actable.locator);
  try {
    await pw.click({ timeout: 2_000 });
  } catch (err) {
    const raw = err instanceof Error ? err.message : `${actable.key} click failed`;
    return {
      kind: "expectFailed",
      message: oneLineBug(raw) || `${actable.key} click failed`,
      widgetRef: actable.key,
    };
  }
  if (!isField(actable.widget) && actable.widget.opens) {
    const opened = findSurface(state, actable.widget.opens);
    if (opened?.locator) {
      await toPlaywrightLocator(state.page, opened.locator)
        .waitFor({ state: "visible" })
        .catch(() => undefined);
    }
    if (!state.surfaceStack.includes(actable.widget.opens)) {
      state.surfaceStack.push(actable.widget.opens);
    }
  }
  return undefined;
}

async function performFill(
  state: RunState,
  surfaceId: string,
  id: string,
  value: string,
): Promise<StepFailure | undefined> {
  const actable = requireActable(state, surfaceId, id);
  if (!actable.ok) return actable.failure;
  const resolved = await resolveSecretAsync(value);
  const raw = widgetLocator(state.page, actable.surface, actable.locator);
  const pw = await pickActable(raw, state.page, { timeoutMs: ACTABLE_WAIT_MS });
  if (!pw) {
    return {
      kind: "expectFailed",
      message: actableMissMessage(actable.key, await explainActableMiss(raw, state.page)),
      widgetRef: actable.key,
    };
  }
  recordLocator(state, actable.key, actable.locator);
  const field = isField(actable.widget) ? actable.widget : undefined;
  if (field?.type === "checkbox") {
    if (resolved === "" || resolved === "false") await pw.uncheck();
    else await pw.check();
    return undefined;
  }
  if (field?.type === "select") {
    await pw.selectOption(resolved);
    return undefined;
  }
  await pw.fill("");
  if (resolved !== "") await pw.fill(resolved);
  return undefined;
}

async function performExpectInvalid(
  state: RunState,
  surfaceId: string,
  id: string,
): Promise<StepFailure | undefined> {
  const actable = requireActable(state, surfaceId, id);
  if (!actable.ok) return actable.failure;
  const pw = await pickActable(widgetLocator(state.page, actable.surface, actable.locator), state.page);
  if (!pw) {
    return {
      kind: "expectFailed",
      message: `expected ${widgetKey(surfaceId, id)} invalid`,
      widgetRef: widgetKey(surfaceId, id),
    };
  }
  const visible = await pw.isVisible().catch(() => false);
  const ariaInvalid = (await pw.getAttribute("aria-invalid").catch(() => null)) === "true";
  const errorVisible = await state.page
    .getByTestId(`${id}-error`)
    .isVisible()
    .catch(() => false);
  if (visible && (ariaInvalid || errorVisible)) return undefined;
  return {
    kind: "expectFailed",
    message: `expected ${widgetKey(surfaceId, id)} invalid`,
    widgetRef: widgetKey(surfaceId, id),
  };
}

async function performExpectVisible(
  state: RunState,
  surfaceId: string,
): Promise<StepFailure | undefined> {
  const surface = findSurface(state, surfaceId);
  const pageDef = findPage(state, surfaceId) ?? findPage(state);
  let loc: Locator | undefined = surface?.locator;
  if (!loc && pageDef) loc = pageDef.ready;
  if (!loc) {
    return { kind: "unknownId", message: `unknown surface ${surfaceId}`, widgetRef: surfaceId };
  }
  const visible = await toPlaywrightLocator(state.page, loc).isVisible().catch(() => false);
  if (visible) return undefined;
  return {
    kind: "expectFailed",
    message: `expected ${surfaceId} visible`,
    widgetRef: surfaceId,
  };
}

/** Latest still of the page the live URL maps to — not a stale `state.pageId`. */
export function writePageStill(state: RunState, shotPath: string): void {
  if (!existsSync(shotPath)) return;
  const appOrigin = originOfHref(state.config.url);
  const matched = appOrigin
    ? findPageForHref(state.model.pages, state.page.url(), appOrigin)
    : undefined;
  const pageId = matched?.id ?? (appOrigin ? undefined : state.pageId?.trim());
  if (!pageId) return;
  const pagesDir = join(state.outDir, "shots", "pages");
  mkdirSync(pagesDir, { recursive: true });
  copyFileSync(shotPath, join(pagesDir, `${slug(pageId)}.png`));
}

export async function captureStepShot(
  state: RunState,
  opts?: { label?: string },
): Promise<string | undefined> {
  const dir = join(state.outDir, "shots");
  mkdirSync(dir, { recursive: true });
  const n = String(state.log.steps.length).padStart(3, "0");
  const filename = opts?.label ? `step-${n}-${slug(opts.label)}.png` : `step-${n}.png`;
  const path = join(dir, filename);
  await state.page.screenshot({ path, fullPage: true }).catch(() => undefined);
  if (!existsSync(path)) return undefined;
  state.lastScreenshotPath = path;
  return path;
}

async function performScreenshot(
  state: RunState,
  label?: string,
  ui?: boolean,
): Promise<StepFailure | undefined> {
  await captureStepShot(state, label ? { label } : undefined);
  if (!ui) return undefined;
  return {
    kind: "uiIssue",
    message: label?.trim() || "UI issue captured",
    url: state.page.url(),
  };
}

async function performExpectPath(state: RunState, path: string): Promise<StepFailure | undefined> {
  let pathname: string;
  try {
    pathname = new URL(state.page.url()).pathname;
  } catch {
    pathname = state.page.url();
  }
  if (pathMatches(path, pathname)) return undefined;
  return {
    kind: "expectFailed",
    message: `expected path ${path}, got ${pathname}`,
    url: state.page.url(),
  };
}

export async function performStep(state: RunState, step: Step): Promise<StepFailure | undefined> {
  switch (step.kind) {
    case "open":
      return performOpen(state, step.page);
    case "click":
      return performClick(state, step.surface, step.id);
    case "fill":
      return performFill(state, step.surface, step.id, step.value);
    case "expectInvalid":
      return performExpectInvalid(state, step.surface, step.id);
    case "expectVisible":
      return performExpectVisible(state, step.surface);
    case "expectPath":
      return performExpectPath(state, step.path);
    case "screenshot":
      return performScreenshot(state, step.label, step.ui);
  }
}
