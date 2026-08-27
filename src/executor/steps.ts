import type { Locator as PwLocator, Page, Request } from "playwright";
import { validationMissExplanation, type FindingKind } from "../schema/finding.js";
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
import {
  clickFailureMessage,
  closeOpenOverlays,
  coveredByMessage,
  describeClickHit,
  dismissLeftoverMenuCover,
} from "./click-hit.js";
import type { Step } from "../schema/log.js";
import type { Action, Field, Page as PageDef, Surface, Widget } from "../schema/page-model.js";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { slug } from "../surveyor/ids.js";
import {
  ACTABLE_WAIT_MS,
  actableMissMessage,
  disabledControlHints,
  explainActableMiss,
  pickActable,
  toPlaywrightLocator,
  tryFallbackFormSubmit,
  widgetLocator,
} from "./locators.js";
import type { RunState } from "./run.js";
import { resolveSecretAsync } from "./secrets.js";
import { isPotentialWrite, isPrimaryFormCommit, looksLikeSubmitClick } from "./write-policy.js";
import { readFieldConstraints } from "./field-constraints.js";
import {
  clipFillValue,
  clearTrackedFills,
  fieldLooksInvalid,
  fillShouldLookInvalid,
  pageHasBlockingInvalid,
  readFieldValidity,
  rememberTrackedFill,
  shouldReportSilentSubmit,
  SILENT_SUBMIT_MESSAGE,
  validationMissesToReport,
  type FieldValidity,
  type TrackedFill,
  type WatchedRequest,
} from "./field-validity.js";
import { applyFieldFill, resolveFieldControl } from "./field-control.js";

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

function isOptionWidget(w: Widget): boolean {
  if (isField(w)) return false;
  if (w.by === "role" && String(w.value).toLowerCase() === "option") return true;
  return w.id.toLowerCase().startsWith("option_");
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
  const control = await resolveFieldControl(pw, undefined, field);
  return control.empty(pw, field);
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
  clearTrackedFills(state);
  return undefined;
}

const INVALID_SETTLE_MS = 800;
const SUBMIT_REQUEST_TYPES = new Set(["document", "xhr", "fetch"]);

function startSubmitRequestWatch(page: Page): { requests: WatchedRequest[]; stop: () => void } {
  const requests: WatchedRequest[] = [];
  const onRequest = (req: Request) => {
    if (!SUBMIT_REQUEST_TYPES.has(req.resourceType())) return;
    let postData: string | null = null;
    try {
      postData = req.postData();
    } catch {
      postData = null;
    }
    const method = req.method();
    requests.push({
      url: req.url(),
      ...(method ? { method } : {}),
      ...(postData ? { postData } : {}),
    });
  };
  page.on("request", onRequest);
  return {
    requests,
    stop: () => {
      page.off("request", onRequest);
    },
  };
}

async function readFieldValiditySettled(
  state: RunState,
  live: Parameters<typeof readFieldValidity>[0],
  fieldId: string,
): Promise<FieldValidity> {
  const started = Date.now();
  let validity = await readFieldValidity(live, state.page, fieldId);
  while (!fieldLooksInvalid(validity) && Date.now() - started < INVALID_SETTLE_MS) {
    if (state.pendingFindings.some((f) => f.kind === "pageError")) return validity;
    await state.page.waitForTimeout(100);
    validity = await readFieldValidity(live, state.page, fieldId);
  }
  return validity;
}

async function checkTrackedFillsAfterSubmit(
  state: RunState,
  watch: { requests: WatchedRequest[] },
): Promise<StepFailure | undefined> {
  const suspects = (state.lastFills ?? []).filter((f) => f.shouldInvalid);
  if (suspects.length === 0) return undefined;
  if (state.pendingFindings.some((f) => f.kind === "pageError")) return undefined;
  const unmarked: TrackedFill[] = [];
  const gone: TrackedFill[] = [];
  for (const last of suspects) {
    const filled = findWidget(state, last.surface, last.id);
    if (!filled) {
      gone.push(last);
      continue;
    }
    const loc = widgetLocator(state.page, filled.surface, locatorOf(filled.widget));
    const visible = await loc.first().isVisible().catch(() => false);
    if (!visible) {
      gone.push(last);
      continue;
    }
    const live = loc.first();
    const validity = await readFieldValiditySettled(state, live, last.id);
    if (state.pendingFindings.some((f) => f.kind === "pageError")) return undefined;
    const liveValue = await live.inputValue().catch(() => last.value);
    const stillJunk =
      liveValue === last.value
        ? last.shouldInvalid
        : fillShouldLookInvalid({ id: last.id }, liveValue);
    rememberTrackedFill(state, { ...last, value: liveValue, shouldInvalid: stillJunk, validity });
    if (stillJunk && !fieldLooksInvalid(validity)) unmarked.push({ ...last, value: liveValue, validity });
  }
  if (state.pendingFindings.some((f) => f.kind === "pageError")) return undefined;
  const stillOk = validationMissesToReport({ unmarked, gone, requests: watch.requests });
  if (stillOk.length === 0) return undefined;
  const first = stillOk[0]!;
  return {
    kind: "expectFailed",
    message: validationMissExplanation(
      stillOk.map((f) => ({ field: `${f.surface}.${f.id}`, value: clipFillValue(f.value) })),
    ),
    widgetRef: widgetKey(first.surface, first.id),
  };
}

async function readTrackedValidityAfterSubmit(state: RunState): Promise<FieldValidity[]> {
  const out: FieldValidity[] = [];
  for (const last of state.lastFills ?? []) {
    const filled = findWidget(state, last.surface, last.id);
    if (!filled) continue;
    const loc = widgetLocator(state.page, filled.surface, locatorOf(filled.widget));
    const visible = await loc.first().isVisible().catch(() => false);
    if (!visible) continue;
    const validity = await readFieldValiditySettled(state, loc.first(), last.id);
    rememberTrackedFill(state, { ...last, validity });
    out.push(validity);
  }
  return out;
}

async function checkSilentFailedSubmit(
  state: RunState,
  watch: { requests: WatchedRequest[] },
  submit: PwLocator,
  urlBefore: string,
  widgetRef: string,
): Promise<StepFailure | undefined> {
  const suspects = (state.lastFills ?? []).filter((f) => f.shouldInvalid);
  if (suspects.length === 0) {
    await state.page.waitForTimeout(INVALID_SETTLE_MS);
  }
  const validity = await readTrackedValidityAfterSubmit(state);
  if (await pageHasBlockingInvalid(state.page)) {
    validity.push({ ariaInvalid: false, errorVisible: false, nativeInvalid: true });
  }
  if (
    !shouldReportSilentSubmit({
      urlChanged: state.page.url() !== urlBefore,
      submitVisible: await submit.isVisible().catch(() => false),
      requests: watch.requests,
      validity,
    })
  ) {
    return undefined;
  }
  return { kind: "expectFailed", message: SILENT_SUBMIT_MESSAGE, widgetRef };
}

async function pickClickable(
  state: RunState,
  loc: ReturnType<typeof widgetLocator>,
  key: string,
): Promise<{ ok: true; locator: PwLocator } | { ok: false; failure: StepFailure }> {
  await dismissLeftoverMenuCover(loc, state.page);
  let pw = await pickActable(loc, state.page, { timeoutMs: 0, scroll: true });
  if (!pw) {
    const miss = await explainActableMiss(loc, state.page);
    if (miss === "covered") {
      await dismissLeftoverMenuCover(loc, state.page);
      pw = await pickActable(loc, state.page, { timeoutMs: 800, scroll: true });
    } else if (miss === "disabled") {
      pw = await pickActable(loc, state.page, { timeoutMs: ACTABLE_WAIT_MS, scroll: true });
    }
  }
  if (!pw) {
    const miss = await explainActableMiss(loc, state.page);
    if (miss === "covered") {
      const hit = await describeClickHit(loc.first(), state.page);
      return { ok: false, failure: { kind: "expectFailed", message: coveredByMessage(key, hit), widgetRef: key } };
    }
    return { ok: false, failure: await actableMissFailure(state, key, loc) };
  }
  return { ok: true, locator: pw };
}

async function actableMissFailure(
  state: RunState,
  key: string,
  loc: ReturnType<typeof widgetLocator>,
): Promise<StepFailure> {
  const miss = await explainActableMiss(loc, state.page);
  const extra =
    miss === "disabled"
      ? {
          waitSeconds: Math.round(ACTABLE_WAIT_MS / 1000),
          fills: (state.lastFills ?? []).map((f) => ({
            ref: `${f.surface}.${f.id}`,
            value: clipFillValue(f.value),
          })),
          hints: await disabledControlHints(loc, state.page),
        }
      : undefined;
  return {
    kind: "expectFailed",
    message: actableMissMessage(key, miss, extra),
    widgetRef: key,
  };
}

async function performClick(
  state: RunState,
  surfaceId: string,
  id: string,
): Promise<StepFailure | undefined> {
  const actable = requireActable(state, surfaceId, id);
  if (!actable.ok) return actable.failure;
  const raw = widgetLocator(state.page, actable.surface, actable.locator);
  if (!isField(actable.widget) && !state.inIntro) {
    const blocked = await writePolicyBlocked(state, actable.surface, actable.widget, actable.locator);
    if (blocked) {
      recordLocator(state, actable.key, actable.locator);
      return blocked;
    }
  }
  recordLocator(state, actable.key, actable.locator);
  const primary = !isField(actable.widget) && isPrimaryFormCommit(actable.widget);
  const watchingSubmit =
    !isField(actable.widget) && looksLikeSubmitClick(actable.widget, actable.surface.actions);
  const urlBefore = watchingSubmit || primary ? state.page.url() : undefined;
  const watch = watchingSubmit || primary ? startSubmitRequestWatch(state.page) : undefined;
  const pw = await pickClickable(state, raw, actable.key);
  try {
    if (pw.ok) {
      try {
        await pw.locator.click({ timeout: 2_000 });
      } catch (err) {
        if (!primary || !(await tryFallbackFormSubmit(state.page, raw.first()))) {
          const rawErr = err instanceof Error ? err.message : `${actable.key} click failed`;
          const hit = /intercepts pointer events/i.test(rawErr)
            ? await describeClickHit(pw.locator, state.page)
            : undefined;
          return {
            kind: "expectFailed",
            message: clickFailureMessage({ widgetKey: actable.key, error: rawErr, hit }),
            widgetRef: actable.key,
          };
        }
      }
    } else if (!primary || !(await tryFallbackFormSubmit(state.page, raw.first()))) {
      return pw.failure;
    }
    if (isOptionWidget(actable.widget)) {
      await closeOpenOverlays(state.page, pw.ok ? pw.locator : raw.first());
    }
    const submitLoc = pw.ok ? pw.locator : raw.first();
    if (watch && urlBefore !== undefined) {
      const missed = await checkTrackedFillsAfterSubmit(state, watch);
      if (missed) return missed;
      if (primary) {
        const silent = await checkSilentFailedSubmit(state, watch, submitLoc, urlBefore, actable.key);
        if (silent) return silent;
      }
    }
  } finally {
    watch?.stop();
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
  step: Extract<Step, { kind: "fill" }>,
): Promise<StepFailure | undefined> {
  const { surface: surfaceId, id, value } = step;
  const actable = requireActable(state, surfaceId, id);
  if (!actable.ok) return actable.failure;
  const resolved = await resolveSecretAsync(value);
  const raw = widgetLocator(state.page, actable.surface, actable.locator);
  const pw = await pickClickable(state, raw, actable.key);
  if (!pw.ok) return pw.failure;
  recordLocator(state, actable.key, actable.locator);
  const field = isField(actable.widget) ? actable.widget : undefined;
  const applied = await applyFieldFill(pw.locator, state.page, field, resolved, actable.key);
  await closeOpenOverlays(state.page, pw.locator);
  if (!applied.ok) {
    return { kind: "expectFailed", message: applied.message, widgetRef: actable.key };
  }
  step.value = applied.value;
  if (!applied.track) return undefined;
  const constraints = await readFieldConstraints(pw.locator);
  const validity = await readFieldValidity(pw.locator, state.page, id);
  const liveValue = applied.value;
  const shouldInvalid = fillShouldLookInvalid(
    {
      id,
      type: field?.type,
      required: field?.required,
      label: field?.name ?? field?.previousLabel,
      constraints,
    },
    liveValue,
  );
  rememberTrackedFill(state, { surface: surfaceId, id, value: liveValue, shouldInvalid, validity });
  return undefined;
}

function invalidExpectFailure(_state: RunState, surfaceId: string, id: string): StepFailure {
  const key = widgetKey(surfaceId, id);
  return {
    kind: "expectFailed",
    message: `expected ${key} invalid`,
    widgetRef: key,
  };
}

async function performExpectInvalid(
  state: RunState,
  surfaceId: string,
  id: string,
): Promise<StepFailure | undefined> {
  const actable = requireActable(state, surfaceId, id);
  if (!actable.ok) return actable.failure;
  const pw = await pickActable(widgetLocator(state.page, actable.surface, actable.locator), state.page);
  if (!pw) return invalidExpectFailure(state, surfaceId, id);
  const visible = await pw.isVisible().catch(() => false);
  const validity = await readFieldValidity(pw, state.page, id);
  if (visible && fieldLooksInvalid(validity)) return undefined;
  return invalidExpectFailure(state, surfaceId, id);
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
  const control = await resolveFieldControl(pw, state.page, field);
  if (await control.expect(pw, field, value)) return undefined;
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
      return performFill(state, step);
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
