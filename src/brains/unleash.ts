import { formatStep } from "../schema/dsl.js";
import type { Page } from "../schema/page-model.js";
import type { ShownAction, ShownField, View } from "../schema/view.js";
import type { Brain, BrainContext, BrainDecision } from "./types.js";
import { detectWalkerMode } from "./walker-mode.js";

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)]!;
}

/** Map leans on chrome; unleash leans on the page body. */
export const LANDMARK_BIAS = 0.75;

export function pickAction(
  actions: readonly ShownAction[],
  rng: () => number,
  prefer: "nav" | "main",
): ShownAction {
  const preferred =
    prefer === "nav" ? actions.filter((a) => a.nav) : actions.filter((a) => !a.nav);
  const pool = preferred.length > 0 && rng() < LANDMARK_BIAS ? preferred : actions;
  return pick(pool, rng);
}

export function formatClick(surface: string, action: ShownAction): string {
  return formatStep({
    kind: "click",
    surface,
    id: action.id,
    ...(action.nav ? { nav: true } : {}),
  });
}

const WRITE_ID =
  /^(submit|save|delete|remove|destroy|confirm|send|update|apply|publish|add_to_cart|add_to_bag)$/i;
const WRITE_LABEL =
  /\b(submit|save|delete|remove|destroy|confirm|send|update|apply|publish|add to (?:cart|bag))\b/i;
const LEAVE_ID =
  /(^|_)(sign_out|signout|log_out|logout|log_off|sign_off|close_panel|close_all_tabs|collapse_menu)$|(^|_)close_[a-z0-9]/i;
const LEAVE_LABEL = /\b(sign out|log out|logout|sign off|close panel)\b|^close\b/i;

export function matchesSkip(
  widget: { id: string; label?: string },
  skip: readonly string[] | undefined,
): boolean {
  if (!skip || skip.length === 0) return false;
  const id = widget.id.toLowerCase();
  const label = (widget.label ?? "").toLowerCase();
  return skip.some((raw) => {
    const s = raw.toLowerCase().trim();
    if (!s) return false;
    const snake = s.replace(/\s+/g, "_");
    return id.includes(snake) || label.includes(s);
  });
}

export function isLeaveAction(action: { id: string; label?: string; opens?: string }): boolean {
  if (action.opens) return false;
  if (LEAVE_ID.test(action.id)) return true;
  if (action.label && LEAVE_LABEL.test(action.label)) return true;
  return false;
}

/** Dialog X / Cancel — leave an empty modal, but never treat as submit. */
export function isDismissAction(action: { id: string; label?: string; opens?: string }): boolean {
  const id = action.id.toLowerCase();
  const label = (action.label ?? "").toLowerCase().trim();
  if (/(^|_)(cancel|dismiss)(_|$)/.test(id)) return true;
  if (/(^|_)close$/.test(id)) return true;
  if (/^(close|cancel|dismiss|×|x)$/.test(label)) return true;
  return false;
}

/** Dialog openers (`opens`) are navigation even when the id looks like a write. */
export function isWriteAction(action: ShownAction): boolean {
  if (action.opens) return false;
  if (isLeaveAction(action)) return true;
  if (WRITE_ID.test(action.id)) return true;
  if (action.label && WRITE_LABEL.test(action.label)) return true;
  return false;
}

export function navigateActions(view: View, skip?: readonly string[]): ShownAction[] {
  return view.actions.filter((a) => !isWriteAction(a) && !matchesSkip(a, skip));
}

/** Action ids that appear on at least half of mapped pages — site chrome, not this surface. */
export function sharedChromeIds(pages: readonly Page[]): Set<string> {
  const n = pages.length;
  if (n < 2) return new Set();
  const thresh = Math.max(2, Math.ceil(n / 2));
  const counts = new Map<string, number>();
  for (const page of pages) {
    const ids = new Set<string>();
    for (const surface of page.surfaces) {
      if (surface.kind === "dialog") continue;
      for (const action of surface.actions) ids.add(action.id);
    }
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const chrome = new Set<string>();
  for (const [id, count] of counts) {
    if (count >= thresh) chrome.add(id);
  }
  return chrome;
}

/** Widgets unique to this surface (not a nav landmark, not duplicated site chrome). */
export function inPageActions(view: View, pages?: readonly Page[]): ShownAction[] {
  const chrome = pages ? sharedChromeIds(pages) : new Set<string>();
  return view.actions.filter((a) => !a.nav && !chrome.has(a.id));
}

/** `opens` another map page — a hop, not a dialog on this surface. */
export function isPageHop(
  action: ShownAction,
  pages?: readonly Page[],
  hopIds?: readonly string[],
): boolean {
  if (!action.opens) return false;
  if (hopIds?.includes(action.opens)) return true;
  if (pages?.some((p) => p.id === action.opens)) return true;
  return false;
}

/** Sidebar/header links: landmark, role=link, or minted `link_` / `menuitem_` ids. */
export function looksLikeNavWidget(action: ShownAction): boolean {
  if (action.nav) return true;
  const role = (action.role ?? "").toLowerCase();
  if (role === "link" || role === "menuitem") return true;
  const id = action.id.toLowerCase();
  return id.startsWith("link_") || id.startsWith("menuitem_");
}

/** In-page actions minus dismiss while a form is on screen. */
export function legalUnleashActions(view: View, pages?: readonly Page[]): ShownAction[] {
  const actions = inPageActions(view, pages);
  if (view.shown.length === 0) return actions;
  return actions.filter((a) => !isDismissAction(a) && !isLeaveAction(a));
}

/**
 * Buttons and dialogs that stay on this surface. Unique record links and
 * sidebar hops are legal only after these (and any empty fields) are gone.
 */
export function stayActions(view: View, pages?: readonly Page[]): ShownAction[] {
  return legalUnleashActions(view, pages).filter(
    (a) => !isPageHop(a, pages, view.pages) && !looksLikeNavWidget(a),
  );
}

export function hopPage(view: View, rng: () => number): BrainDecision {
  const pages = view.pages ?? [];
  const others = pages.filter((id) => id !== view.page);
  const justHopped = Boolean(view.last?.step.startsWith("open "));
  if (justHopped) {
    return { line: formatStep({ kind: "screenshot" }), note: "no legal widgets after hop" };
  }
  if (others.length > 0) {
    return { line: formatStep({ kind: "open", page: pick(others, rng) }), note: "hop" };
  }
  if (pages.includes(view.page)) {
    return { line: formatStep({ kind: "open", page: view.page }), note: "no legal widgets" };
  }
  return { line: formatStep({ kind: "screenshot" }), note: "no hoppable pages" };
}

/** Short fill. Empty is legal under validationOnly; `allow` fills a value so submit can fire. */
export function plausibleFill(
  type: ShownField["type"],
  rng: () => number = Math.random,
  emptyOk = true,
): string {
  if (emptyOk && rng() < 0.5) return "";
  switch (type) {
    case "number":
      return "1";
    case "email":
      return "user@example.com";
    default:
      return "x";
  }
}

const DESTRUCTIVE = /delete|remove|destroy/i;
/** Ids like button_add_customer, create_invoice — not "address". */
const SUBMIT_ID = /(^|_)(submit|save|create|apply|publish|send|update|confirm|run|next|continue|done|finish|ok|add)(_|$)/i;
const SUBMIT_LABEL =
  /\b(submit|save|create|apply|publish|send|update|confirm|run|next|continue|done|finish|add)\b|^ok$/i;

export const FORM_BURST_MAX = 12;
/** After filling, click Cancel/Close this often; otherwise submit. Cancel rarely finds bugs. */
export const FORM_DISMISS_RATE = 0.2;
/** Last N clicks on this page. Oldest drop off; not cache LRU (least-recently-used). */
export const RECENT_CLICK_WINDOW = 8;
/** Skip a widget after this many appearances in the window. */
export const RECENT_CLICK_LIMIT = 2;

export function rememberClick(recent: readonly string[], id: string, cap = RECENT_CLICK_WINDOW): string[] {
  const next = [...recent, id];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

export function clickCountInRecent(recent: readonly string[], id: string): number {
  return recent.filter((x) => x === id).length;
}

/** Drop widgets already clicked twice in the recent window, and the immediately previous click. */
export function freshClicks(
  actions: readonly ShownAction[],
  recent: readonly string[] | undefined,
  limit = RECENT_CLICK_LIMIT,
): ShownAction[] {
  if (!recent || recent.length === 0) return [...actions];
  const last = recent[recent.length - 1];
  return actions.filter((a) => a.id !== last && clickCountInRecent(recent, a.id) < limit);
}

/** `opens` that points at this surface is a mis-stamp, not a hop. */
export function isSelfOpen(action: { opens?: string }, surface?: string): boolean {
  return Boolean(surface && action.opens === surface);
}

/** Submit/save/create/add on this surface — not a page hop and not a delete. */
export function formSubmitAction(
  actions: readonly ShownAction[],
  surface?: string,
): ShownAction | undefined {
  return actions.find((a) => {
    if (a.opens && !isSelfOpen(a, surface)) return false;
    if (isDismissAction(a) || isLeaveAction(a)) return false;
    const blob = `${a.id} ${a.label ?? ""}`;
    if (DESTRUCTIVE.test(blob)) return false;
    if (isWriteAction(a)) return true;
    if (SUBMIT_ID.test(a.id)) return true;
    if (a.label && SUBMIT_LABEL.test(a.label)) return true;
    return false;
  });
}

export function formDismissAction(actions: readonly ShownAction[]): ShownAction | undefined {
  return actions.find((a) => isDismissAction(a) && !isLeaveAction(a));
}

export function decideForm(
  view: View,
  actions: ShownAction[],
  rng: () => number,
  fill: (type: ShownField["type"]) => string,
): BrainDecision | undefined {
  const fields = view.shown;
  const submit = formSubmitAction(actions, view.surface);
  if (fields.length === 0 || !submit) return undefined;
  const empty = fields.filter((f) => !f.value.trim() || f.value === "••••");
  const toFill = empty.slice(0, FORM_BURST_MAX);
  const lines: string[] = toFill.map((field) =>
    formatStep({
      kind: "fill",
      surface: view.surface,
      id: field.id,
      value: fill(field.type),
    }),
  );
  const dismiss = formDismissAction(view.actions);
  const finish = dismiss && rng() < FORM_DISMISS_RATE ? dismiss : submit;
  lines.push(formatClick(view.surface, finish));
  return {
    line: lines[0]!,
    lines,
    note: finish === dismiss ? "form dismiss" : toFill.length > 0 ? "form" : "form submit",
  };
}

function inDialog(view: View): boolean {
  return view.stack.length > 1;
}

/** Pick a page mode from the view, then that mode's legal moves. */
export function decideUnleashWork(
  ctx: BrainContext,
  rng: () => number,
  fill: (type: ShownField["type"]) => string,
): BrainDecision {
  const mode = detectWalkerMode(ctx);
  const decision = mode.decide(ctx, rng, fill);
  return { ...decision, mode: mode.name };
}

export function decideUnleash(ctx: BrainContext, rng: () => number = Math.random): BrainDecision {
  return decideUnleashWork(ctx, rng, (type) =>
    plausibleFill(type, rng, ctx.writePolicy === "allow" || inDialog(ctx.view) ? false : true),
  );
}

/** Click links and other non-write actions. Never fill. Hop to a known page when stuck. */
export function decideMap(ctx: BrainContext, rng: () => number = Math.random): BrainDecision {
  const { view } = ctx;
  const nav = navigateActions(view);
  if (nav.length === 0) return hopPage(view, rng);
  const action = pickAction(nav, rng, "nav");
  return { line: formatClick(view.surface, action) };
}

export const unleashBrain: Brain = {
  name: "unleash",
  decide: (ctx) => decideUnleash(ctx),
};

export const mapBrain: Brain = {
  name: "map",
  decide: (ctx) => decideMap(ctx),
};
