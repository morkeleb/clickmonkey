import { formatStep } from "../schema/dsl.js";
import type { Page } from "../schema/page-model.js";
import type { ShownAction, ShownField, View } from "../schema/view.js";
import { looksLikeListedPicker, planControlFill } from "../executor/field-control.js";
import { fakerFill } from "./faker-fill.js";
import type { Brain, BrainContext, BrainDecision } from "./types.js";
import { detectWalkerMode } from "./walker-mode.js";
import { decideMapScout } from "./map-scout.js";

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
export const DESTRUCTIVE = /delete|remove|destroy/i;
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

/** Mapped dialog on this page, opened from a live action. Not a page hop. */
export function isDialogOpener(
  action: ShownAction,
  view: View,
  pages?: readonly Page[],
): boolean {
  if (!action.opens || isSelfOpen(action, view.surface)) return false;
  if (isPageHop(action, pages, view.pages)) return false;
  const page = pages?.find((p) => p.id === view.page);
  return Boolean(page?.surfaces.some((s) => s.kind === "dialog" && s.id === action.opens));
}

export function dialogOpeners(view: View, pages?: readonly Page[]): ShownAction[] {
  return view.actions.filter((a) => isDialogOpener(a, view, pages));
}

/** Archive/Delete confirm — not Edit. `opens` id or label, or a field-less confirm dialog. */
export function isDestructiveDialogOpener(
  action: { id: string; label?: string; opens?: string },
  page?: Pick<Page, "surfaces">,
): boolean {
  const blob = `${action.id} ${action.label ?? ""} ${action.opens ?? ""}`;
  if (DESTRUCTIVE.test(blob) || /archive/i.test(blob)) return true;
  if (!action.opens || !page) return false;
  const surface = page.surfaces.find((s) => s.kind === "dialog" && s.id === action.opens);
  if (!surface) return false;
  const body = surface.fields.filter((f) => f.status === "ok" && !looksLikeSearchField({ id: f.id, value: "", type: f.type }));
  if (body.length > 0) return false;
  return surface.actions.some((a) => DESTRUCTIVE.test(a.id) || /(^|_)(confirm|archive)(_|$)/i.test(a.id));
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

/** Record row hops (`customers_row_*`, `link_row_1`). Not a page-header "New …" CTA. */
export function isRecordRowAction(action: ShownAction): boolean {
  return /(?:^|_)row(?:_|$)/i.test(action.id);
}

/**
 * Sidebar/header landmarks and menu items.
 * In-page `<a>` CTAs (`role=link`, minted `link_*`) are ordinary actions — apps
 * routinely style links as buttons.
 */
export function looksLikeNavWidget(action: ShownAction): boolean {
  if (action.nav) return true;
  const role = (action.role ?? "").toLowerCase();
  if (role === "menuitem") return true;
  return action.id.toLowerCase().startsWith("menuitem_");
}

/** In-page actions minus dismiss while a form is on screen. */
export function legalUnleashActions(view: View, pages?: readonly Page[]): ShownAction[] {
  const actions = inPageActions(view, pages);
  const live =
    view.shown.length === 0 ? actions : actions.filter((a) => !isDismissAction(a) && !isLeaveAction(a));
  if (!searchIsActive(view)) return live;
  return live.filter((a) => !isEmptyStateAction(a));
}

/** Repeating line/split rows to fill (`lineitems_0__…`, `items[0].…`). Do not spawn more. */
export const FORM_CHILD_ROWS = 1;

/**
 * In-page controls, including links styled as buttons and unique hops like
 * "New migration". Landmark chrome and table-row hops wait.
 */
export function stayActions(view: View, pages?: readonly Page[]): ShownAction[] {
  const rows = repeatingRowCount(view);
  const hasCommit = Boolean(
    formSubmitAction(view.actions, view.surface, view) ?? mappedPrimaryCommits(view, pages)[0],
  );
  const holdForm = looksLikeUnfinishedForm(view) || looksLikeMidForm(view) || hasCommit;
  return legalUnleashActions(view, pages).filter((a) => {
    if (looksLikeNavWidget(a) || isRecordRowAction(a)) return false;
    if (isAddRepeatingRowAction(a) && rows >= FORM_CHILD_ROWS) return false;
    if (holdForm && /(_remove_|_add_row)/i.test(a.id)) return false;
    if (holdForm && isTabAction(a)) return false;
    return true;
  });
}

/** `lineitems_0__amount`, `items[0].name`, `row_0_qty` — not `invoice_1099_tax`. */
export function repeatingRowIndex(id: string): number | undefined {
  const bracket = id.match(/\[(\d+)\]/);
  if (bracket) return Number(bracket[1]);
  const dunder = id.match(/(?:^|_)(\d+)__/);
  if (dunder) return Number(dunder[1]);
  const row = id.match(/(?:^|_)row[_-](\d+)(?:[_-]|$)/i);
  if (row) return Number(row[1]);
  return undefined;
}

export function repeatingRowCount(view: Pick<View, "shown">): number {
  let max = -1;
  for (const f of view.shown) {
    const i = repeatingRowIndex(f.id);
    if (i !== undefined) max = Math.max(max, i);
  }
  return max + 1;
}

export function isAddRepeatingRowAction(action: { id: string; label?: string }): boolean {
  if (/(^|_)add_(row|line|item|entry|split)(_|$)/i.test(action.id)) return true;
  return /\badd (?:a )?(?:row|line|item|entry)\b/i.test(action.label ?? "");
}

export function skipRepeatingChildField(id: string): boolean {
  const i = repeatingRowIndex(id);
  return i !== undefined && i >= FORM_CHILD_ROWS;
}

/** Open listbox rows. Leftover listed rows keep form mode so we Save; fillTypeahead clicks the row for the field being filled. */
export function isListedTypeaheadOption(action: ShownAction): boolean {
  if ((action.role ?? "").toLowerCase() === "option") return true;
  return action.id.toLowerCase().startsWith("option_");
}

export function listedTypeaheadOptions(actions: readonly ShownAction[]): ShownAction[] {
  return actions.filter(isListedTypeaheadOption);
}

/**
 * True when a currently live listed row was already clicked — same open list.
 * A new list (industry gone, attorney options appear) is not this.
 */
export function alreadyPickedListedOption(
  view: Pick<View, "actions">,
  recentClicks?: readonly string[],
): boolean {
  if (!recentClicks?.length) return false;
  const recent = new Set(recentClicks);
  return listedTypeaheadOptions(view.actions).some((a) => recent.has(a.id));
}

const SORT_TOGGLE_ID = /sorted[_-]?(ascending|descending)/i;
const PAGINATION_ID = /(^|_)(previous|next|prev)$/i;

export function isComboboxAction(action: ShownAction): boolean {
  if ((action.role ?? "").toLowerCase() === "combobox") return true;
  return action.id.toLowerCase().startsWith("combobox_");
}

/** Minted tab widgets (`tab_overview`, `tabs_billing`). Not “new tab” / close-tab chrome. */
const TAB_ID = /(^|_)tabs?_/;
const NOT_TAB_ID = /(^|_)(new|close)_tabs?(_|$)|open_in_.*_tabs?(_|$)/;
const NOT_TAB_LABEL = /\b((open in|new|close)\s+tabs?)\b/;

export function isTabAction(action: ShownAction): boolean {
  if ((action.role ?? "").toLowerCase() === "tab") return true;
  const id = action.id.toLowerCase();
  if (NOT_TAB_ID.test(id)) return false;
  if (id.includes("tablist") || TAB_ID.test(id)) return true;
  const label = (action.label ?? "").toLowerCase();
  if (!/\btabs?\b/.test(label) || /\btable\b/.test(label) || NOT_TAB_LABEL.test(label)) return false;
  return true;
}

export function isSortToggleAction(action: ShownAction): boolean {
  if (SORT_TOGGLE_ID.test(action.id)) return true;
  const label = (action.label ?? "").toLowerCase();
  return /\bsort(ed|ing)?\b/.test(label) && /\b(asc|desc|switch|toggle|order)\b/.test(label);
}

export function isPaginationAction(action: ShownAction): boolean {
  return PAGINATION_ID.test(action.id);
}

/** Filters, sort, pagination — list chrome, not a commit form. */
export function isListChrome(action: ShownAction): boolean {
  return isComboboxAction(action) || isSortToggleAction(action) || isPaginationAction(action);
}

export function looksLikeSearchField(field: ShownField): boolean {
  const id = field.id.toLowerCase();
  if (/(^|_)(q|query|search|filter|find)(_|$)/.test(id)) return true;
  const words = field.id.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  const blob = `${words} ${field.label ?? ""}`.toLowerCase();
  return /\b(search|query|filter|find)\b/.test(blob);
}

/**
 * Landmark / list search (Lois, bare `q`/`search`, `customers_filter_q`).
 * Not a form body picker like `vendortype_search`.
 */
export function looksLikePageSearch(field: ShownField): boolean {
  const id = field.id.toLowerCase();
  const label = (field.label ?? "").toLowerCase();
  const blob = `${id.replace(/[_-]+/g, " ")} ${label}`;
  if (/\blois\b|\btalk to\b/.test(blob)) return true;
  const stem = id.replace(/^(textbox|input|field)_/, "");
  if (/^(q|query|search|filter|find)(_input)?$/.test(stem)) return true;
  // List/table filter chrome — not a type-in body field.
  return /(^|_)filter(_|$)/.test(id);
}

/**
 * TanStack/shadcn row checkboxes share one aria-label and vanish when the
 * table is empty. Not a form field; filling them is a false "not found".
 */
export function looksLikeRowSelectCheckbox(field: {
  id: string;
  type?: string;
  label?: string;
}): boolean {
  if (field.type && field.type !== "checkbox") return false;
  const blob = `${field.id} ${field.label ?? ""}`.toLowerCase();
  return /row.?selection|toggle_row_selection|press_space_to_toggle/.test(blob);
}

function isBodyField(field: ShownField): boolean {
  return field.type !== "checkbox" && !looksLikePageSearch(field) && !looksLikeRowSelectCheckbox(field);
}

const SELECT_PLACEHOLDER = /^(select|choose|pick|search)\b/i;

/** Blank, password mask, leftover placeholder, or a "Select…" chip with no choice. */
export function looksLikeEmptyValue(field: ShownField): boolean {
  const v = field.value.trim();
  if (!v || v === "••••") return true;
  const ph = field.constraints?.placeholder?.trim();
  if (ph && v === ph) return true;
  if (SELECT_PLACEHOLDER.test(v)) return true;
  return false;
}

export { looksLikeListedPicker };

function lastFailedFillId(view: View): string | undefined {
  const last = view.last;
  if (!last || last.ok) return undefined;
  const m = /^fill \S+\.(\S+)/.exec(last.step);
  return m?.[1];
}

function commitTried(ctx?: Pick<BrainContext, "recentClicks">): boolean {
  return (ctx?.recentClicks ?? []).some((id) => isPrimaryFormCommit({ id }));
}

function commitFailed(ctx?: Pick<BrainContext, "last">): boolean {
  return Boolean(ctx?.last && ctx.last.ok === false);
}

function isFormFillCandidate(
  field: ShownField,
  skipId: string | undefined,
  checkboxes: boolean,
): boolean {
  if (looksLikePageSearch(field) || looksLikeRowSelectCheckbox(field) || skipRepeatingChildField(field.id)) {
    return false;
  }
  if (skipId && field.id === skipId) return false;
  if (field.type === "checkbox") return checkboxes;
  return looksLikeEmptyValue(field);
}

/** Empty body fields on this form, required first. Listed pickers are fields too. */
export function formFieldsToFill(
  view: View,
  ctx?: Pick<BrainContext, "recentClicks" | "last">,
  opts?: { checkboxes?: boolean },
): ShownField[] {
  void ctx;
  const skipId = lastFailedFillId(view);
  const candidates = view.shown.filter((f) => isFormFillCandidate(f, skipId, opts?.checkboxes !== false));
  return candidates.sort((a, b) => Number(Boolean(b.required)) - Number(Boolean(a.required)));
}

/** Type-in / select fields that are not search or row-select chrome. */
export function emptyBodyFields(view: Pick<View, "shown">): ShownField[] {
  return view.shown.filter((f) => isBodyField(f) && looksLikeEmptyValue(f));
}

/** Body fields that already have a real value (not a Select… chip). */
export function filledBodyFields(view: Pick<View, "shown">): ShownField[] {
  return view.shown.filter((f) => isBodyField(f) && !looksLikeEmptyValue(f));
}

/** Create-style pages often disable Save until dirty; still treat them as a form. */
export const UNFINISHED_FORM_EMPTY = 4;

export function looksLikeUnfinishedForm(view: Pick<View, "shown">): boolean {
  return emptyBodyFields(view).length >= UNFINISHED_FORM_EMPTY;
}

/** Started filling (some body values) and still has empties — do not hop tabs. */
export function looksLikeMidForm(view: Pick<View, "shown">): boolean {
  return filledBodyFields(view).length > 0 && emptyBodyFields(view).length > 0;
}

/**
 * Keep a form burst going after a listed/typeahead fill miss so later fills and
 * Save still run. Crash and fence bounce still abort.
 */
export function continueFormBurst(
  kind: string | undefined,
  result: { ok: boolean; bounced?: boolean; findingKind?: string },
): boolean {
  if (result.bounced || result.findingKind === "pageError") return false;
  if (kind === "fill") return true;
  return result.ok;
}

/** Empty-list CTA (“Create your first …”). Hidden once a filter/search has a value. */
export function isEmptyStateAction(action: ShownAction): boolean {
  const id = action.id.toLowerCase();
  const label = (action.label ?? "").toLowerCase();
  if (id.includes("your_first") || id.includes("create_your_first") || id.includes("add_your_first")) {
    return true;
  }
  if (/\byour first\b/.test(label) || /\bget started\b/.test(label)) return true;
  return false;
}

export function searchIsActive(view: View): boolean {
  return view.shown.some((f) => looksLikeSearchField(f) && f.value.trim() !== "" && f.value !== "••••");
}

/** In-page list chrome; landmark dropdowns and row links do not count. */
function listSignalPool(view: View): ShownAction[] {
  return view.actions.filter(
    (a) => !a.nav && !looksLikeNavWidget(a) && !isLeaveAction(a) && !isDismissAction(a),
  );
}

function hasComboKind(view: View, pool: readonly ShownAction[]): boolean {
  if (pool.some(isComboboxAction)) return true;
  return view.shown.some((f) => f.type === "select");
}

/** List kinds except pager — wizard Next must not count as a second signal. */
export function nonPagerListKinds(view: View, pages?: readonly Page[]): number {
  const pool = listSignalPool(view);
  let n = 0;
  if (hasComboKind(view, pool)) n += 1;
  if (pool.some(isSortToggleAction)) n += 1;
  if (view.shown.some(looksLikeSearchField)) n += 1;
  if (listRowActions(view, pages).length > 0) n += 1;
  return n;
}

/** Distinct in-page list-chrome kinds (combo, sort, search, row, pager). */
export function listModeScore(view: View, pages?: readonly Page[]): number {
  const n = nonPagerListKinds(view, pages);
  return listSignalPool(view).some(isPaginationAction) ? n + 1 : n;
}

export function listChromeActions(actions: readonly ShownAction[]): ShownAction[] {
  return actions.filter(isListChrome);
}

/** Record hops, including in-page row links not yet stamped with `opens`. */
export function listRowActions(view: View, pages?: readonly Page[]): ShownAction[] {
  return legalUnleashActions(view, pages).filter((a) => {
    if (isListChrome(a) || a.nav || looksLikeNavWidget(a)) return false;
    return isRecordRowAction(a);
  });
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

export { pickSelectOption } from "../executor/select-options.js";

export type FillFn = (field: ShownField) => string;

/** Short fill. Empty is legal under validationOnly; `allow` fills a value so submit can fire. */
export function plausibleFill(
  field: ShownField,
  rng: () => number = Math.random,
  emptyOk = true,
): string {
  const planned = planControlFill(field, rng, emptyOk);
  if (planned !== undefined) return planned;
  if (emptyOk && rng() < 0.5) return "";
  return fakerFill(field, rng);
}

/** Commit verb is the last id segment (`button_save`, not `create_client_…_add_row`). */
const SUBMIT_ID = /(^|_)(submit|save|create|apply|publish|send|update|confirm|run|next|continue|done|finish|ok)$/i;
const SUBMIT_LABEL =
  /\b(submit|save|create|apply|publish|send|update|confirm|run|next|continue|done|finish)\b|^ok$/i;

/** After filling, click Cancel/Close this often; otherwise submit. Cancel rarely finds bugs. */
export const FORM_DISMISS_RATE = 0.2;
/** Last N clicks on this page. Oldest drop off; not cache LRU (least-recently-used). */
export const RECENT_CLICK_WINDOW = 8;
/** Skip a widget after this many appearances in the window. */
export const RECENT_CLICK_LIMIT = 2;
/** Extra Save clicks after stay/fail. Total Saves = 1 + this. Not a loop. */
export const FORM_COMMIT_RETRIES = 2;
/** List filters/sort/pager: one sample each, then a row. */
export const LIST_CHROME_LIMIT = 1;

/**
 * Group widgets that are the same control with a swapped id (asc↔desc, prev↔next).
 * Idempotent on already-canonical keys (`~sort`, `~page`).
 */
export function clickKey(id: string): string {
  if (SORT_TOGGLE_ID.test(id)) return "~sort";
  if (PAGINATION_ID.test(id)) return "~page";
  return id;
}

export function rememberClick(recent: readonly string[], id: string, cap = RECENT_CLICK_WINDOW): string[] {
  const next = [...recent, id];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

export function clickCountInRecent(recent: readonly string[], id: string): number {
  const key = clickKey(id);
  return recent.filter((x) => clickKey(x) === key).length;
}

/** Two (or one) keys filling the recent window — a ping-pong, not exploration. */
export function loopingClickKeys(recent: readonly string[]): Set<string> {
  if (recent.length < 4) return new Set();
  const keys = recent.slice(-RECENT_CLICK_WINDOW).map(clickKey);
  const unique = new Set(keys);
  if (unique.size <= 2) return unique;
  return new Set();
}

/** Drop the last click-key, two-key loops, and ids already at `limit` in the window. */
export function freshClicks(
  actions: readonly ShownAction[],
  recent: readonly string[] | undefined,
  limit = RECENT_CLICK_LIMIT,
): ShownAction[] {
  if (!recent || recent.length === 0) return [...actions];
  const lastKey = clickKey(recent[recent.length - 1]!);
  const looping = loopingClickKeys(recent);
  return actions.filter((a) => {
    const key = clickKey(a.id);
    if (key === lastKey) return false;
    if (looping.has(key)) return false;
    return clickCountInRecent(recent, a.id) < limit;
  });
}

export function withoutNoops(
  actions: readonly ShownAction[],
  noopIds: readonly string[] | undefined,
): ShownAction[] {
  if (!noopIds || noopIds.length === 0) return [...actions];
  const dead = new Set(noopIds.map(clickKey));
  return actions.filter((a) => !dead.has(clickKey(a.id)));
}

/** Every walker click pick goes through here so a loop cannot sit on one widget. */
export function usableClicks(
  actions: readonly ShownAction[],
  ctx: Pick<BrainContext, "recentClicks" | "noopIds"> | undefined,
  limit = RECENT_CLICK_LIMIT,
): ShownAction[] {
  return freshClicks(withoutNoops(actions, ctx?.noopIds), ctx?.recentClicks, limit);
}

/** Page + stack + widget ids. Values ignored — a snackbar is not a new surface. */
export function viewWidgetSig(view: View): string {
  const shown = view.shown.map((f) => f.id).sort().join(",");
  const actions = view.actions.map((a) => a.id).sort().join(",");
  return `${view.page}\0${view.stack.join(">")}\0${shown}\0${actions}`;
}

export function clickWasNoop(
  before: { url: string; sig: string },
  after: { url: string; sig: string },
): boolean {
  return before.url === after.url && before.sig === after.sig;
}

/** `opens` that points at this surface is a mis-stamp, not a hop. */
export function isSelfOpen(action: { opens?: string }, surface?: string): boolean {
  return Boolean(surface && action.opens === surface);
}

/** Add/Create that opens a dialog — not Save. A submit that hops to a record page is not this. */
export function opensPageDialog(
  action: { opens?: string },
  page?: Pick<Page, "surfaces">,
  surfaceId?: string,
): boolean {
  if (!action.opens || isSelfOpen(action, surfaceId)) return false;
  return Boolean(page?.surfaces.some((s) => s.kind === "dialog" && s.id === action.opens));
}

function hasPagerPair(actions: readonly ShownAction[]): boolean {
  const pool = actions.filter((a) => !a.nav && !looksLikeNavWidget(a) && isPaginationAction(a));
  const hasPrev = pool.some((a) => /(^|_)(previous|prev)$/i.test(a.id));
  const hasNext = pool.some((a) => /(^|_)next$/i.test(a.id));
  return hasPrev && hasNext;
}

/** Next/Continue on a stepper — not list Previous+Next. */
export function isWizardAdvance(action: ShownAction): boolean {
  if (isLeaveAction(action) || isDismissAction(action) || isSortToggleAction(action)) return false;
  const id = action.id.toLowerCase();
  const label = (action.label ?? "").toLowerCase();
  if (/(^|_)(previous|prev)(_|$)/.test(id) || /\b(previous|prev|back)\b/.test(label)) return false;
  if (/(^|_)(next|continue)$/.test(id)) return true;
  if (/^(next|continue)$/i.test(label.trim())) return true;
  return false;
}

/** Fields plus Next/Continue, and not a list pager. */
export function looksLikeWizard(view: View): boolean {
  if (formSubmitIsListPager(view.actions, view)) return false;
  const bodyFields = view.shown.filter((f) => !looksLikeSearchField(f) && !looksLikeRowSelectCheckbox(f));
  if (bodyFields.length === 0) return false;
  return formSubmitActions(view.actions, view.surface, view).some(isWizardAdvance);
}

/** Wizard Next stays submit; a Previous+Next pair with other list chrome is pagination. */
export function formSubmitIsListPager(actions: readonly ShownAction[], view?: View): boolean {
  if (view) {
    const n = nonPagerListKinds(view);
    return n >= 2 || (n >= 1 && hasPagerPair(view.actions));
  }
  const pool = actions.filter((a) => !a.nav && !looksLikeNavWidget(a));
  const comboOrSort = pool.some(isComboboxAction) || pool.some(isSortToggleAction);
  if (pool.some(isComboboxAction) && pool.some(isSortToggleAction)) return true;
  return comboOrSort && hasPagerPair(actions);
}

/** Existing / Create-new segmented modes are not Save. */
export function looksLikeModeSwitch(action: { id: string; label?: string }): boolean {
  if (/_mode_/.test(action.id)) return true;
  const label = (action.label ?? "").toLowerCase().trim();
  return /^(existing|create new)$/.test(label);
}

export function isFormSubmit(
  a: ShownAction,
  surface: string | undefined,
  listPager: boolean,
): boolean {
  if (a.opens && !isSelfOpen(a, surface)) return false;
  if (/(^|_)open_/.test(a.id)) return false;
  if (isDismissAction(a) || isLeaveAction(a)) return false;
  if (isSortToggleAction(a)) return false;
  if (looksLikeModeSwitch(a)) return false;
  if (isPaginationAction(a) && listPager) return false;
  if (isAddRepeatingRowAction(a)) return false;
  if (/(^|_)add_filter(_|$)/i.test(a.id)) return false;
  if (isEmptyStateAction(a)) return false;
  const blob = `${a.id} ${a.label ?? ""}`;
  if (DESTRUCTIVE.test(blob)) return false;
  if (isWriteAction(a)) return true;
  if (SUBMIT_ID.test(a.id)) return true;
  if (a.label && SUBMIT_LABEL.test(a.label)) return true;
  return false;
}

/** Lower is a stronger commit. Prefer Save/Create over Apply/Next. */
function submitRank(a: ShownAction): number {
  const blob = `${a.id} ${a.label ?? ""}`.toLowerCase();
  if (/(^|_)(save|create|submit|publish)(_|$)/.test(a.id) || /\b(save|create|submit|publish)\b/.test(blob)) {
    return 0;
  }
  if (/(^|_)(apply|update|confirm|send)(_|$)/.test(a.id) || /\b(apply|update|confirm|send)\b/.test(blob)) {
    return 1;
  }
  return 2;
}

/** Save first, then Create/Publish, then Submit. Executor falls back to native submit if Save stays disabled. */
export function commitKindRank(action: { id: string; label?: string }): number {
  const blob = `${action.id} ${action.label ?? ""}`.toLowerCase();
  if (/(^|_)save(_|$)/.test(action.id) || /\bsave\b/.test(blob)) return 0;
  if (/(^|_)(create|publish)(_|$)/.test(action.id) || /\b(create|publish)\b/.test(blob)) return 1;
  if (/(^|_)submit(_|$)/.test(action.id) || /\bsubmit\b/.test(blob)) return 2;
  return 3;
}

/** Save/Create/Submit/Publish — not Apply/Next/filter, Close, mode toggle, or a dialog opener. */
export function isPrimaryFormCommit(
  action: { id: string; label?: string; name?: string; opens?: string },
  page?: Pick<Page, "surfaces">,
  surfaceId?: string,
): boolean {
  const label = action.label ?? action.name;
  const bare = { id: action.id, ...(label ? { label } : {}) };
  if (isLeaveAction(bare) || isDismissAction(bare)) return false;
  if (looksLikeModeSwitch(bare)) return false;
  if (opensPageDialog(action, page, surfaceId)) return false;
  return submitRank(bare) === 0;
}

/** Mapped Save/Create/Submit even when the live control is disabled (omitted from the view). */
export function mappedPrimaryCommits(view: View, pages?: readonly Page[]): ShownAction[] {
  if (!pages || pages.length === 0) return [];
  const page = pages.find((p) => p.id === view.page);
  if (!page) return [];
  const current = page.surfaces.find((s) => s.id === view.surface);
  // Page-level Create (`list_action_create`) is not the dialog Save.
  const surfaces =
    current && current.kind !== "page"
      ? [current]
      : page.surfaces.filter((s) => s.id === view.surface || s.kind === "page");
  const out: ShownAction[] = [];
  const seen = new Set<string>();
  for (const surface of surfaces) {
    for (const a of surface.actions) {
      if (a.status !== "ok") continue;
      if (!isPrimaryFormCommit(a, page, surface.id)) continue;
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push({ id: a.id, ...(a.opens ? { opens: a.opens } : {}) });
    }
  }
  return out;
}

function formCommitActions(
  view: View,
  liveActions: readonly ShownAction[],
  pages?: readonly Page[],
): ShownAction[] {
  const live = formSubmitActions(liveActions, view.surface, view);
  const byId = new Map<string, ShownAction>();
  for (const a of mappedPrimaryCommits(view, pages)) byId.set(a.id, a);
  for (const a of live) byId.set(a.id, a);
  return [...byId.values()].sort((a, b) => commitKindRank(a) - commitKindRank(b) || submitRank(a) - submitRank(b));
}

/** Submit/save/create on this surface — not a page hop and not a delete. */
export function formSubmitActions(
  actions: readonly ShownAction[],
  surface?: string,
  view?: View,
): ShownAction[] {
  const listPager = formSubmitIsListPager(actions, view);
  return actions.filter((a) => isFormSubmit(a, surface, listPager)).sort((a, b) => submitRank(a) - submitRank(b));
}

export function formSubmitAction(
  actions: readonly ShownAction[],
  surface?: string,
  view?: View,
): ShownAction | undefined {
  return formSubmitActions(actions, surface, view)[0];
}

export function formDismissAction(actions: readonly ShownAction[]): ShownAction | undefined {
  return actions.find((a) => isDismissAction(a) && !isLeaveAction(a));
}

export function decideForm(
  view: View,
  actions: ShownAction[],
  rng: () => number,
  fill: FillFn,
  ctx?: Pick<BrainContext, "recentClicks" | "noopIds" | "pages" | "last" | "lockForm">,
): BrainDecision | undefined {
  const fields = view.shown;
  const commits = formCommitActions(view, actions, ctx?.pages);
  // Leftover option_* rows (previous combobox, painted NAICS, a chip) are not
  // the current field. fillTypeahead clicks the listed row for the control
  // being filled. Clicking a leftover option hops chrome or covers Save.
  if (fields.length === 0 || commits.length === 0) return undefined;
  const live = formSubmitActions(actions, view.surface, view);
  const liveFresh = usableClicks(live, ctx).sort((a, b) => commitKindRank(a) - commitKindRank(b));
  const mappedOnly = commits.filter((c) => !live.some((l) => l.id === c.id));
  const mappedFresh = usableClicks(mappedOnly, ctx).sort((a, b) => commitKindRank(a) - commitKindRank(b));
  let finishPool = liveFresh.length > 0 ? liveFresh : mappedFresh;
  const stayedAfterCommit = Boolean(ctx?.last?.ok === true && commitTried(ctx));
  if (commitFailed(ctx) || (stayedAfterCommit && finishPool.length === 0)) {
    const saveLimit = 1 + FORM_COMMIT_RETRIES;
    const retry = live
      .filter((a) => clickCountInRecent(ctx?.recentClicks ?? [], a.id) < saveLimit)
      .sort((a, b) => commitKindRank(a) - commitKindRank(b));
    if (retry.length > 0) finishPool = retry;
  }
  if (finishPool.length === 0) return undefined;
  const ranked = formFieldsToFill(view, ctx);
  const lines: string[] = ranked.map((field) =>
    formatStep({
      kind: "fill",
      surface: view.surface,
      id: field.id,
      value: fill(field),
    }),
  );
  const dismiss = formDismissAction(view.actions);
  const dismissOk = Boolean(
    !ctx?.lockForm &&
      dismiss &&
      rng() < FORM_DISMISS_RATE &&
      withoutNoops([dismiss], ctx?.noopIds).length > 0,
  );
  const finish = dismissOk && dismiss ? dismiss : finishPool[0]!;
  lines.push(formatClick(view.surface, finish));
  return {
    line: lines[0]!,
    lines,
    note: finish.id === dismiss?.id ? "form dismiss" : ranked.length > 0 ? "form" : "form submit",
  };
}

function inDialog(view: View): boolean {
  return view.stack.length > 1;
}

/** Pick a page mode from the view, then that mode's legal moves. */
export function decideUnleashWork(
  ctx: BrainContext,
  rng: () => number,
  fill: FillFn,
): BrainDecision {
  const mode = detectWalkerMode(ctx);
  const decision = mode.decide(ctx, rng, fill);
  return { ...decision, mode: mode.name };
}

export function decideUnleash(ctx: BrainContext, rng: () => number = Math.random): BrainDecision {
  return decideUnleashWork(ctx, rng, (field) =>
    plausibleFill(field, rng, ctx.writePolicy === "allow" || inDialog(ctx.view) ? false : true),
  );
}

/** Click links and other non-write actions. Never fill. Hop to a known page when stuck. */
export function decideMap(ctx: BrainContext, rng: () => number = Math.random): BrainDecision {
  const scout = decideMapScout(ctx, rng);
  if (scout) return scout;
  const { view } = ctx;
  const nav = usableClicks(navigateActions(view), ctx);
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
