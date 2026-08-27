import { formatStep, parseLine } from "../schema/dsl.js";
import type { Page } from "../schema/page-model.js";
import type { View } from "../schema/view.js";
import type { BrainContext, BrainDecision } from "./types.js";
import {
  decideForm,
  dialogOpeners,
  formatClick,
  formFieldsToFill,
  formSubmitAction,
  formSubmitActions,
  formSubmitIsListPager,
  isDialogOpener,
  isFormSubmit,
  isRecordRowAction,
  isTabAction,
  isWizardAdvance,
  hopPage,
  legalUnleashActions,
  isListChrome,
  LIST_CHROME_LIMIT,
  listChromeActions,
  listModeScore,
  listRowActions,
  pickAction,
  isEmptyStateAction,
  isPrimaryFormCommit,
  mappedPrimaryCommits,
  listedTypeaheadOptions,
  looksLikeUnfinishedForm,
  looksLikeMidForm,
  looksLikeWizard,
  emptyBodyFields,
  filledBodyFields,
  searchIsActive,
  stayActions,
  usableClicks,
  withoutNoops,
  type FillFn,
} from "./unleash.js";
import { decideFormHunt, FORM_HUNT_STAY_RATE, isOnFormLock } from "./form-hunt.js";
import { fogHunger, modeFogKey, staleMsForPage, type WalkerModeName } from "../schema/fog.js";

export type { WalkerModeName };

/** Notes that mean the walker just filled or left a form/wizard surface. */
export function isFormWorkNote(note?: string): boolean {
  return (
    note === "form" ||
    note === "form submit" ||
    note === "form dismiss" ||
    note === "wizard" ||
    note === "wizard dismiss"
  );
}

/** Notes that mean a commit click (submit / wizard Next-or-Save), not dismiss. */
export function isFormCommitNote(note?: string): boolean {
  return note === "form" || note === "form submit" || note === "wizard";
}

export interface WalkerMode {
  name: WalkerModeName;
  detect(ctx: BrainContext): boolean;
  decide(
    ctx: BrainContext,
    rng: () => number,
    fill: FillFn,
  ): BrainDecision;
}

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)]!;
}

/** Submit on this surface, including self-`opens`. writePolicy/dialog do not gate detect. */
function hasSurfaceSubmit(ctx: BrainContext): boolean {
  const { view } = ctx;
  const legal = legalUnleashActions(view, ctx.pages);
  return Boolean(
    formSubmitAction(legal, view.surface, view) ??
      formSubmitAction(view.actions, view.surface, view) ??
      mappedPrimaryCommits(view, ctx.pages)[0],
  );
}

function hasEmptyFormField(view: View): boolean {
  return emptyBodyFields(view).length > 0;
}

function formHitKey(ctx: BrainContext): string {
  return `${ctx.view.page}/${ctx.view.surface}`;
}

function filledThisForm(ctx: BrainContext): boolean {
  return (ctx.formHits?.[formHitKey(ctx)] ?? 0) > 0;
}

function hasCommit(ctx: BrainContext): boolean {
  return ctx.view.actions.some(isPrimaryFormCommit) || mappedPrimaryCommits(ctx.view, ctx.pages).length > 0;
}

function hasListedTypeaheadOptions(view: View): boolean {
  return listedTypeaheadOptions(view.actions).length > 0;
}

function saveNotTried(ctx: BrainContext): boolean {
  return !(ctx.recentClicks ?? []).some((id) => isPrimaryFormCommit({ id }));
}

/** Empty body fields plus Save, a still-disabled create form, or we already started filling. */
function shouldStayOnForm(ctx: BrainContext): boolean {
  if (hasListedTypeaheadOptions(ctx.view) && hasCommit(ctx)) return true;
  if (hasEmptyFormField(ctx.view)) {
    if (hasCommit(ctx)) return true;
    return looksLikeUnfinishedForm(ctx.view) || looksLikeMidForm(ctx.view) || filledThisForm(ctx);
  }
  // Just filled — Save/Create has not run yet. Do not hunt or hop.
  if (hasCommit(ctx) && saveNotTried(ctx) && filledBodyFields(ctx.view).length > 0) return true;
  return filledThisForm(ctx) && hasCommit(ctx);
}

function fillEmptyBurst(view: View, fill: FillFn, ctx?: BrainContext): BrainDecision | undefined {
  const empty = formFieldsToFill(view, ctx, { checkboxes: false });
  if (empty.length === 0) return undefined;
  const lines = empty.map((field) =>
    formatStep({
      kind: "fill",
      surface: view.surface,
      id: field.id,
      value: fill(field),
    }),
  );
  return { line: lines[0]!, lines, note: "form" };
}

function hopOrChromeFallback(view: View, rng: () => number, ctx?: BrainContext): BrainDecision {
  if (ctx && shouldStayOnForm(ctx) && (!ctx.lockForm || isOnFormLock(ctx))) {
    return { line: formatStep({ kind: "screenshot" }), note: "form stay" };
  }
  const hunt = ctx ? decideFormHunt(ctx, rng) : undefined;
  if (hunt) return hunt;
  if (ctx?.lockForm && isOnFormLock(ctx)) {
    return { line: formatStep({ kind: "screenshot" }), note: "form lock" };
  }
  if (ctx?.lockForm) {
    return { line: formatStep({ kind: "open", page: ctx.lockForm }), note: "form hunt" };
  }
  const hop = hopPage(view, rng);
  if (!hop.line.startsWith("screenshot") || view.actions.length === 0) return hop;
  const actions = searchIsActive(view)
    ? view.actions.filter((a) => !isEmptyStateAction(a))
    : view.actions;
  const pool = usableClicks(actions, ctx);
  if (pool.length === 0) return hop;
  return { line: formatClick(view.surface, pickAction(pool, rng, "nav")) };
}

function huntOrLocal(
  ctx: BrainContext,
  rng: () => number,
  local: () => BrainDecision,
): BrainDecision {
  if (ctx.lockForm) {
    if (isOnFormLock(ctx)) return local();
    const pinned = decideFormHunt(ctx, rng);
    if (pinned) return pinned;
    return local();
  }
  if (shouldStayOnForm(ctx)) return local();
  if ((ctx.lootSteps ?? 0) > 0) return local();
  const hunt = decideFormHunt(ctx, rng);
  if (hunt && rng() >= FORM_HUNT_STAY_RATE) return hunt;
  return local();
}

function decideNav(ctx: BrainContext, rng: () => number, fill: FillFn): BrainDecision {
  const { view } = ctx;
  const legal = legalUnleashActions(view, ctx.pages);
  const stay = stayActions(view, ctx.pages);
  const fields = view.shown;

  if (legal.length === 0 && fields.length === 0) return hopOrChromeFallback(view, rng, ctx);

  const leftover = fillEmptyBurst(view, fill, ctx);
  if (leftover) return leftover;

  return huntOrLocal(ctx, rng, () => {
    const stayFresh = usableClicks(stay, ctx);
    if (stayFresh.length > 0) {
      return { line: formatClick(view.surface, pick(stayFresh, rng)) };
    }
    // stayActions already dropped add/remove while Save is present.
    if (stay.length > 0) return hopOrChromeFallback(view, rng, ctx);
    const legalFresh = usableClicks(legal, ctx);
    if (legalFresh.length > 0) {
      return { line: formatClick(view.surface, pick(legalFresh, rng)) };
    }
    return hopOrChromeFallback(view, rng, ctx);
  });
}

function canCommit(ctx: BrainContext): boolean {
  return ctx.writePolicy === "allow" || ctx.view.stack.length > 1 || Boolean(ctx.lockForm);
}

function decideWizard(ctx: BrainContext, rng: () => number, fill: FillFn): BrainDecision {
  const { view } = ctx;
  if (!canCommit(ctx)) {
    const leftover = fillEmptyBurst(view, fill, ctx);
    if (leftover) return { ...leftover, note: "wizard" };
    return hopOrChromeFallback(view, rng, ctx);
  }
  const legal = legalUnleashActions(view, ctx.pages);
  // Same Next id every step is the stepper. usableClicks/~page would drop it.
  const advances = withoutNoops(
    formSubmitActions(legal, view.surface, view).filter(isWizardAdvance),
    ctx.noopIds,
  );
  const leftover = fillEmptyBurst(view, fill, ctx);
  if (advances.length > 0) {
    const fills = leftover ? (leftover.lines ?? [leftover.line]) : [];
    const click = formatClick(view.surface, pick(advances, rng));
    if (fills.length > 0) {
      return { line: fills[0]!, lines: [...fills, click], note: "wizard" };
    }
    return { line: click, note: "wizard" };
  }
  if (leftover) return { ...leftover, note: "wizard" };
  const form = decideForm(view, legal, rng, fill, ctx);
  if (form) return { ...form, note: form.note === "form dismiss" ? "wizard dismiss" : "wizard" };
  return hopOrChromeFallback(view, rng, ctx);
}

function decideFormMode(ctx: BrainContext, rng: () => number, fill: FillFn): BrainDecision {
  const { view } = ctx;
  const legal = legalUnleashActions(view, ctx.pages);
  if (canCommit(ctx)) {
    const form = decideForm(view, legal, rng, fill, ctx);
    if (form) return form;
  }
  const leftover = fillEmptyBurst(view, fill, ctx);
  if (leftover) return leftover;
  return hopOrChromeFallback(view, rng, ctx);
}

function decideList(ctx: BrainContext, rng: () => number, fill: FillFn): BrainDecision {
  const { view } = ctx;
  const legal = legalUnleashActions(view, ctx.pages);
  if (canCommit(ctx) && hasEmptyFormField(view)) {
    const form = decideForm(view, legal, rng, fill, ctx);
    if (form) return form;
  }
  const leftover = fillEmptyBurst(view, fill, ctx);
  if (leftover) return leftover;

  return huntOrLocal(ctx, rng, () => decideListLocal(ctx, rng));
}

function decideListLocal(ctx: BrainContext, rng: () => number): BrainDecision {
  const { view } = ctx;
  const stay = stayActions(view, ctx.pages);
  const chrome = usableClicks(listChromeActions(stay), ctx, LIST_CHROME_LIMIT);
  if (chrome.length > 0) {
    return { line: formatClick(view.surface, pick(chrome, rng)), note: "list chrome" };
  }

  const rows = usableClicks(listRowActions(view, ctx.pages), ctx);
  if (rows.length > 0) {
    return { line: formatClick(view.surface, pick(rows, rng)), note: "list row" };
  }

  const other = usableClicks(
    stay.filter((a) => !isListChrome(a)),
    ctx,
  );
  if (other.length > 0) {
    return { line: formatClick(view.surface, pick(other, rng)), note: "list stay" };
  }

  return hopOrChromeFallback(view, rng, ctx);
}

const wizardMode: WalkerMode = {
  name: "wizard",
  detect: (ctx) => looksLikeWizard(ctx.view),
  decide: decideWizard,
};

const formMode: WalkerMode = {
  name: "form",
  detect: (ctx) =>
    (ctx.view.shown.length > 0 && hasSurfaceSubmit(ctx)) ||
    looksLikeUnfinishedForm(ctx.view) ||
    looksLikeMidForm(ctx.view) ||
    (filledThisForm(ctx) && hasEmptyFormField(ctx.view)) ||
    (hasListedTypeaheadOptions(ctx.view) && hasSurfaceSubmit(ctx)),
  decide: decideFormMode,
};

function decideTab(ctx: BrainContext, rng: () => number, _fill: FillFn): BrainDecision {
  const tabs = usableClicks(ctx.view.actions.filter(isTabAction), ctx);
  if (tabs.length > 0) {
    return { line: formatClick(ctx.view.surface, pick(tabs, rng)), note: "tab" };
  }
  return hopOrChromeFallback(ctx.view, rng, ctx);
}

function decideEmpty(ctx: BrainContext, rng: () => number, _fill: FillFn): BrainDecision {
  const empty = usableClicks(ctx.view.actions.filter(isEmptyStateAction), ctx);
  if (empty.length > 0) {
    return { line: formatClick(ctx.view.surface, pick(empty, rng)), note: "empty" };
  }
  return hopOrChromeFallback(ctx.view, rng, ctx);
}

function decideDialog(ctx: BrainContext, rng: () => number, _fill: FillFn): BrainDecision {
  const openers = usableClicks(dialogOpeners(ctx.view, ctx.pages), ctx);
  if (openers.length === 0) return hopOrChromeFallback(ctx.view, rng, ctx);
  const fresh = openers.filter((a) => {
    if (!a.opens) return false;
    return (ctx.pageVisits?.[`${ctx.view.page}/${a.opens}`] ?? 0) === 0;
  });
  const pool = fresh.length > 0 ? fresh : openers;
  return { line: formatClick(ctx.view.surface, pick(pool, rng)), note: "dialog" };
}

const listMode: WalkerMode = {
  name: "list",
  detect: (ctx) => listModeScore(ctx.view, ctx.pages) >= 2,
  decide: decideList,
};

const tabMode: WalkerMode = {
  name: "tab",
  detect: (ctx) => ctx.view.actions.some(isTabAction),
  decide: decideTab,
};

const dialogMode: WalkerMode = {
  name: "dialog",
  detect: (ctx) => ctx.view.stack.length <= 1 && dialogOpeners(ctx.view, ctx.pages).length > 0,
  decide: decideDialog,
};

const emptyMode: WalkerMode = {
  name: "empty",
  detect: (ctx) => !searchIsActive(ctx.view) && ctx.view.actions.some(isEmptyStateAction),
  decide: decideEmpty,
};

const navMode: WalkerMode = {
  name: "nav",
  detect: () => true,
  decide: decideNav,
};

/** Wizard locks. Other applicable modes compete by least-recent stamp. Nav is fallback. */
export const UNLEASH_MODES: WalkerMode[] = [
  wizardMode,
  formMode,
  listMode,
  tabMode,
  dialogMode,
  emptyMode,
  navMode,
];

function modeHunger(ctx: BrainContext, name: WalkerModeName): number {
  return fogHunger(staleMsForPage(ctx.modeFog, modeFogKey(ctx.view.page, name)));
}

export function detectWalkerMode(ctx: BrainContext): WalkerMode {
  if (wizardMode.detect(ctx)) return wizardMode;
  // Empty fields + Save/Create, a create form whose Save is still disabled, or mid-fill.
  if (formMode.detect(ctx) && shouldStayOnForm(ctx)) {
    return formMode;
  }
  const applicable = UNLEASH_MODES.filter((m) => m.name !== "nav" && m.name !== "wizard" && m.detect(ctx));
  if (applicable.length === 0) return navMode;
  let best = applicable[0]!;
  let bestHunger = modeHunger(ctx, best.name);
  for (const mode of applicable.slice(1)) {
    const hunger = modeHunger(ctx, mode.name);
    if (hunger > bestHunger) {
      best = mode;
      bestHunger = hunger;
    }
  }
  return best;
}

const MODE_WORK_NOTES = new Set([
  "wizard",
  "wizard dismiss",
  "form",
  "form submit",
  "form dismiss",
  "list",
  "list chrome",
  "list row",
  "list stay",
  "tab",
  "dialog",
  "empty",
]);

export function shouldStampMode(decision: BrainDecision): boolean {
  return Boolean(decision.mode && MODE_WORK_NOTES.has(decision.note ?? ""));
}

/** Paladin notes are oracles; stamp only if the DSL line did that mode's work. */
export function lineMatchesMode(
  line: string,
  mode: WalkerModeName,
  view: View,
  pages?: readonly Page[],
): boolean {
  const parsed = parseLine(line);
  if (!parsed || "comment" in parsed) return false;
  if (parsed.kind === "fill") return mode === "form" || mode === "wizard" || mode === "list";
  if (parsed.kind !== "click") return false;
  const action = view.actions.find((a) => a.id === parsed.id);
  if (!action) return false;
  if (mode === "dialog") return isDialogOpener(action, view, pages);
  if (mode === "tab") return isTabAction(action);
  if (mode === "empty") return isEmptyStateAction(action);
  if (mode === "list") return isListChrome(action) || isRecordRowAction(action);
  if (mode === "wizard") return isWizardAdvance(action);
  if (mode === "form") {
    return isFormSubmit(action, view.surface, formSubmitIsListPager(view.actions, view));
  }
  return false;
}
