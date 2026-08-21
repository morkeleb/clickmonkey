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
import {
  formatSelectOptionList,
  matchSelectOption,
  readSelectOptions,
  selectOptionQuery,
} from "./select-options.js";

export type StepFailure = {
  kind: FindingKind;
  message: string;
  widgetRef?: string;
  url?: string;
};

export { locatorOf as widgetLocator } from "../schema/locator.js";
export { readyKey, widgetKey } from "../schema/refs.js";

type ModelState = Pick<RunState, "model" | "pageId">;

export function findPage(state: ModelState, pageId = state.pageId): PageDef | undefined {
  return state.model.pages.find((p) => p.id === pageId);
}

export function findSurface(state: ModelState, surfaceId: string): Surface | undefined {
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
  const pw = await pickActable(raw, state.page, { timeoutMs: ACTABLE_WAIT_MS, scroll: true });
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
        .waitFor({ state: "visible", timeout: 2_000 })
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
  const pw = await pickActable(raw, state.page, { timeoutMs: ACTABLE_WAIT_MS, scroll: true });
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
    const options = await readSelectOptions(pw);
    const match = matchSelectOption(options, resolved);
    if (!match) {
      return {
        kind: "expectFailed",
        message: `select ${actable.key} has no option ${JSON.stringify(resolved)} (options: ${formatSelectOptionList(options)})`,
        widgetRef: actable.key,
      };
    }
    await pw.selectOption(selectOptionQuery(match), { timeout: 2_000 });
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

export function locatorForSurface(
  state: ModelState,
  surfaceId: string,
): { ok: true; loc: Locator } | { ok: false; failure: StepFailure } {
  const surface = findSurface(state, surfaceId);
  if (surface?.locator) return { ok: true, loc: surface.locator };
  const namedPage = findPage(state, surfaceId);
  if (namedPage?.ready) return { ok: true, loc: namedPage.ready };
  if (surface) {
    const owner =
      state.model.pages.find((p) => p.id === state.pageId && p.surfaces.some((s) => s.id === surfaceId)) ??
      state.model.pages.find((p) => p.surfaces.some((s) => s.id === surfaceId));
    if (owner?.ready) return { ok: true, loc: owner.ready };
  }
  return {
    ok: false,
    failure: { kind: "unknownId", message: `unknown surface ${surfaceId}`, widgetRef: surfaceId },
  };
}

async function performExpectVisible(
  state: RunState,
  surfaceId: string,
): Promise<StepFailure | undefined> {
  const found = locatorForSurface(state, surfaceId);
  if (!found.ok) return found.failure;
  const visible = await toPlaywrightLocator(state.page, found.loc).isVisible().catch(() => false);
  if (visible) return undefined;
  return {
    kind: "expectFailed",
    message: `expected ${surfaceId} visible`,
    widgetRef: surfaceId,
  };
}

async function performExpectHidden(
  state: RunState,
  surfaceId: string,
): Promise<StepFailure | undefined> {
  const found = locatorForSurface(state, surfaceId);
  if (!found.ok) return found.failure;
  const visible = await toPlaywrightLocator(state.page, found.loc).isVisible().catch(() => false);
  if (!visible) return undefined;
  return {
    kind: "expectFailed",
    message: `expected ${surfaceId} hidden`,
    widgetRef: surfaceId,
  };
}

function collapseWs(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Browser-side accessible name. Closure-free for locator.evaluate. */
function readAccessibleName(el: {
  id: string;
  innerText: string;
  getAttribute(name: string): string | null;
  closest(sel: string): { innerText: string } | null;
}): string {
  const g = globalThis as unknown as {
    document: {
      getElementById(id: string): { innerText: string } | null;
      querySelector(sel: string): { innerText: string } | null;
    };
    CSS?: { escape(s: string): string };
  };
  const aria = el.getAttribute("aria-label");
  if (aria?.trim()) return aria.trim();
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => g.document.getElementById(id)?.innerText ?? "")
      .join(" ")
      .trim();
    if (text) return text;
  }
  if (el.id) {
    const escaped = g.CSS?.escape(el.id) ?? el.id;
    const t = g.document.querySelector(`label[for="${escaped}"]`)?.innerText.trim() ?? "";
    if (t) return t;
  }
  const wrap = el.closest("label")?.innerText.trim() ?? "";
  if (wrap) return wrap;
  return (el.innerText ?? "").trim();
}

async function firstVisible(raw: ReturnType<Page["locator"]>) {
  const n = await raw.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const el = raw.nth(i);
    if (await el.isVisible().catch(() => false)) return el;
  }
  return undefined;
}

async function performExpectText(
  state: RunState,
  surfaceId: string,
  id: string,
  text: string,
): Promise<StepFailure | undefined> {
  const actable = requireActable(state, surfaceId, id);
  if (!actable.ok) return actable.failure;
  const ref = widgetKey(surfaceId, id);
  const raw = widgetLocator(state.page, actable.surface, actable.locator);
  const needle = collapseWs(text);
  const n = await raw.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const el = raw.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const inner = collapseWs((await el.innerText().catch(() => "")) ?? "");
    const acc = collapseWs((await el.evaluate(readAccessibleName).catch(() => "")) ?? "");
    if (inner.includes(needle) || acc.includes(needle)) return undefined;
  }
  return {
    kind: "expectFailed",
    message: `expected ${ref} text ${JSON.stringify(text)}`,
    widgetRef: ref,
  };
}

async function performExpectValue(
  state: RunState,
  surfaceId: string,
  id: string,
  value: string,
): Promise<StepFailure | undefined> {
  const actable = requireActable(state, surfaceId, id);
  if (!actable.ok) return actable.failure;
  const ref = widgetKey(surfaceId, id);
  const pw = await firstVisible(widgetLocator(state.page, actable.surface, actable.locator));
  if (!pw) {
    return {
      kind: "expectFailed",
      message: `expected ${ref} value ${JSON.stringify(value)}`,
      widgetRef: ref,
    };
  }
  const field = isField(actable.widget) ? actable.widget : undefined;
  if (field?.type === "checkbox") {
    const checked = await pw.isChecked().catch(() => false);
    const wantChecked = value !== "" && value !== "false";
    if (checked === wantChecked) return undefined;
  } else {
    const actual = await pw.inputValue().catch(() => "");
    if (actual === value) return undefined;
  }
  return {
    kind: "expectFailed",
    message: `expected ${ref} value ${JSON.stringify(value)}`,
    widgetRef: ref,
  };
}

async function performExpectPageText(state: RunState, text: string): Promise<StepFailure | undefined> {
  const loc = state.page.getByText(text);
  const n = await loc.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    if (await loc.nth(i).isVisible().catch(() => false)) return undefined;
  }
  return {
    kind: "expectFailed",
    message: `expected text ${JSON.stringify(text)}`,
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
    case "expectHidden":
      return performExpectHidden(state, step.surface);
    case "expectText":
      return performExpectText(state, step.surface, step.id, step.text);
    case "expectValue":
      return performExpectValue(state, step.surface, step.id, step.value);
    case "expectPageText":
      return performExpectPageText(state, step.text);
    case "expectPath":
      return performExpectPath(state, step.path);
    case "screenshot":
      return performScreenshot(state, step.label, step.ui);
  }
}
