import type { Locator as PwLocator, Page } from "playwright";
import { textContainsNastyPayload } from "../brains/nasty.js";
import {
  formatSelectOptionList,
  liveOptionsFromSnaps,
  matchListedOption,
  pickListedOption,
  rankListedOptions,
  type ListRowSnap,
  type LiveSelectOption,
} from "./select-options.js";
import {
  actionDeadline,
  actionTimeoutMs,
  MIN_LIST_WAIT_MS,
  PEEK_TIMEOUT_MS,
  remainingTimeoutMs,
  sliceTimeoutMs,
  typeaheadListWaitMs,
} from "./timeout.js";

export type TypeaheadKind = "none" | "datalist" | "combobox";

export async function typeaheadKindOf(loc: PwLocator, timeoutMs = PEEK_TIMEOUT_MS): Promise<TypeaheadKind> {
  return loc
    .evaluate((el) => {
      const node = el as {
        tagName: string;
        getAttribute(name: string): string | null;
        closest(sel: string): unknown;
        ownerDocument: { getElementById(id: string): { tagName: string } | null };
      };
      if (node.tagName.toLowerCase() === "select") return "none";
      const list = node.getAttribute("list");
      if (list && node.ownerDocument.getElementById(list)?.tagName === "DATALIST") return "datalist";
      const role = (node.getAttribute("role") ?? "").toLowerCase();
      const ac = (node.getAttribute("aria-autocomplete") ?? "").toLowerCase();
      const popup = (node.getAttribute("aria-haspopup") ?? "").toLowerCase();
      if (role === "combobox") return "combobox";
      if (ac === "list" || ac === "both") return "combobox";
      if (popup === "listbox") return "combobox";
      if (node.closest('[role="combobox"]')) return "combobox";
      if (node.closest('[aria-haspopup="listbox"]')) return "combobox";
      const expanded = (node.getAttribute("aria-expanded") ?? "").toLowerCase();
      if (node.tagName.toLowerCase() === "input" && (expanded === "true" || expanded === "false")) {
        return "combobox";
      }
      return "none";
    }, undefined, { timeout: timeoutMs })
    .catch(() => "none" as const);
}

export async function looksLikeTypeahead(loc: PwLocator, timeoutMs = PEEK_TIMEOUT_MS): Promise<boolean> {
  return (await typeaheadKindOf(loc, timeoutMs)) !== "none";
}

/** Harvest/open settle when the walker has not passed `--timeout` into this helper. */
export const TYPEAHEAD_SEARCH_WAIT_MS = 1200;
const TYPEAHEAD_POLL_MS = 50;
/** 1-char English, a digit (coded lists), then 2-char (minLength: 2). At most two probes. */
export const SEARCH_PROBES = ["a", "e", "s", "1", "an", "in", "st", "11"] as const;
const MAX_PROBES = 2;
/** Prompt painted on an unchosen chip (`Select…`, `Search vendors`). */
export const LISTED_CHIP_PROMPT = /^(select|choose|pick|search)\b/i;
/** Painted-row click. Rows are already on screen — do not sit for `--timeout`. */
export const LISTED_CLICK_MS = 800;
const MAX_LISTED_CLICKS = 8;
/** `clickOptionAt` locator list. Each click shares one remaining slice, never 8 × `--timeout`. */
export const LISTED_CLICK_LOCATOR_COUNT = 8;

/** One attribute/kind read from `--timeout`, never 1ms (CDP round-trip is longer) or the full budget. */
export function listedPeekMs(page: Page): number {
  return sliceTimeoutMs(actionDeadline(page), { cap: LISTED_CLICK_MS });
}

function splitIds(raw: string | null | undefined): string[] {
  return (raw ?? "").trim().split(/\s+/).filter(Boolean);
}

async function boundListIds(loc: PwLocator, timeoutMs = PEEK_TIMEOUT_MS): Promise<string[]> {
  const el = loc.first();
  const peek = { timeout: timeoutMs };
  const fromSelf = [
    await el.getAttribute("aria-controls", peek).catch(() => null),
    await el.getAttribute("aria-owns", peek).catch(() => null),
    await el.getAttribute("list", peek).catch(() => null),
  ].flatMap(splitIds);
  if (fromSelf.length > 0) return fromSelf;
  return el
    .evaluate((node) => {
      const host = (node as { closest(sel: string): { getAttribute(name: string): string | null } | null }).closest(
        '[role="combobox"]',
      );
      if (!host) return [] as string[];
      return `${host.getAttribute("aria-controls") ?? ""} ${host.getAttribute("aria-owns") ?? ""}`
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    }, undefined, peek)
    .catch(() => [] as string[]);
}

function idSelector(id: string): string {
  return `[id=${JSON.stringify(id)}]`;
}

async function boundRoot(loc: PwLocator, page: Page): Promise<PwLocator> {
  const ids = await boundListIds(loc.first(), listedPeekMs(page));
  if (ids.length === 0) return page.locator('[role="listbox"], [role="menu"]');
  return page.locator(ids.map(idSelector).join(", "));
}

async function readNativeListOptions(root: PwLocator): Promise<LiveSelectOption[]> {
  return root
    .locator("option")
    .evaluateAll((els) =>
      els.flatMap((el) => {
        const o = el as unknown as { disabled: boolean; value: string; label: string; textContent: string | null };
        if (o.disabled) return [];
        const value = (o.value || "").trim();
        const label = (o.label || o.textContent || value).trim();
        if (!value && !label) return [];
        return [{ value, label: label || value }];
      }),
    )
    .catch(() => [] as LiveSelectOption[]);
}

/** Snapshot painted nodes so Node can drop non-actable chrome (group labels, headings). */
async function snapListRows(loc: PwLocator): Promise<ListRowSnap[]> {
  return loc
    .evaluateAll((els) => {
      return els.flatMap((el) => {
        const node = el as {
          disabled?: boolean;
          onclick?: unknown;
          onmousedown?: unknown;
          onpointerdown?: unknown;
          tabIndex: number;
          tagName: string;
          innerText?: string;
          textContent: string | null;
          getAttribute(name: string): string | null;
          ownerDocument: {
            defaultView: { getComputedStyle(elt: unknown): { pointerEvents: string } } | null;
          };
        };
        const type = (node.getAttribute("type") || "").toLowerCase();
        if (type === "submit" || type === "reset") return [];
        const text = (node.getAttribute("aria-label") || node.innerText || node.textContent || "")
          .replace(/\s+/g, " ")
          .trim();
        if (!text) return [];
        const style = node.ownerDocument.defaultView?.getComputedStyle(node);
        let hasOwnClick = Boolean(node.onclick || node.onmousedown || node.onpointerdown);
        if (node.getAttribute("onclick") || node.getAttribute("onmousedown")) hasOwnClick = true;
        if (!hasOwnClick) {
          for (const k of Object.keys(node)) {
            if (!k.startsWith("__reactProps") && !k.startsWith("__reactEventHandlers")) continue;
            const p = (node as unknown as Record<string, { onClick?: unknown; onMouseDown?: unknown; onPointerDown?: unknown }>)[k];
            if (p && (p.onClick || p.onMouseDown || p.onPointerDown)) {
              hasOwnClick = true;
              break;
            }
          }
        }
        return [
          {
            value: node.getAttribute("data-value") || node.getAttribute("value") || text,
            label: text,
            tag: node.tagName.toLowerCase(),
            role: (node.getAttribute("role") || "").toLowerCase(),
            disabled: Boolean(node.disabled),
            ariaDisabled: node.getAttribute("aria-disabled") === "true",
            pointerEvents: style?.pointerEvents ?? "",
            tabIndex: node.tabIndex,
            hasOwnClick,
          },
        ];
      });
    })
    .catch(() => [] as ListRowSnap[]);
}

async function readActableRows(loc: PwLocator): Promise<LiveSelectOption[]> {
  return liveOptionsFromSnaps(await snapListRows(loc));
}

async function readRoleListOptions(root: PwLocator, visible: boolean): Promise<LiveSelectOption[]> {
  const loc = visible ? root.locator('[role="option"]:visible') : root.locator('[role="option"]');
  const roles = await readActableRows(loc);
  if (roles.length > 0) return roles;
  const extra = visible
    ? root.locator('[role="menuitem"]:visible, button:visible')
    : root.locator('[role="menuitem"], button');
  return readActableRows(extra);
}

/** Options currently attached to this control (listbox, owns, datalist). */
export async function readTypeaheadOptions(loc: PwLocator, page: Page): Promise<LiveSelectOption[]> {
  const peek = listedPeekMs(page);
  const ids = await boundListIds(loc.first(), peek);
  for (const id of ids) {
    const root = page.locator(idSelector(id));
    const native = await readNativeListOptions(root);
    if (native.length > 0) return native;
    const roles = await readRoleListOptions(root, false);
    if (roles.length > 0) return roles;
  }
  if (ids.length > 0) return [];
  return readRoleListOptions(page.locator('[role="listbox"]:visible'), true);
}

function dropCompositeRows(rows: LiveSelectOption[]): LiveSelectOption[] {
  return rows.filter(
    (row) =>
      !rows.some(
        (other) => other !== row && row.label.includes(other.label) && row.label.length > other.label.length + 2,
      ),
  );
}

/** onclick / React onClick / onMouseDown on a node (not delegated addEventListener). */
async function readOwnPointerRows(root: PwLocator): Promise<LiveSelectOption[]> {
  const snaps = (await snapListRows(root.locator("*"))).filter((s) => s.hasOwnClick && s.label.length <= 80);
  return dropCompositeRows(liveOptionsFromSnaps(snaps));
}

/** addEventListener('click'|'mousedown'|…) via Chrome Command Line API. */
async function readCdpListenerRows(page: Page, root: PwLocator): Promise<LiveSelectOption[]> {
  let marked = false;
  try {
    const id = await root.evaluate((el) => {
      const n = el as { id?: string; setAttribute(name: string, value: string): void };
      if (n.id) return n.id;
      n.setAttribute("data-cm-list", "1");
      return "";
    });
    marked = !id;
    const sel = id ? `[id=${JSON.stringify(id)}]` : '[data-cm-list="1"]';
    const session = await page.context().newCDPSession(page);
    const { result } = await session.send("Runtime.evaluate", {
      includeCommandLineAPI: true,
      returnByValue: true,
      expression: `(() => {
        var root = document.querySelector(${JSON.stringify(sel)});
        if (!root) return [];
        var want = { click: 1, mousedown: 1, mouseup: 1, pointerdown: 1, pointerup: 1 };
        var out = [];
        var seen = {};
        var nodes = root.querySelectorAll("*");
        var i;
        for (i = 0; i < nodes.length; i++) {
          var node = nodes[i];
          var listeners = {};
          try { listeners = getEventListeners(node) || {}; } catch (e) {}
          var types = Object.keys(listeners);
          if (!types.some(function (t) { return want[t]; })) continue;
          if (node.getAttribute("aria-disabled") === "true") continue;
          var type = (node.getAttribute("type") || "").toLowerCase();
          if (type === "submit" || type === "reset") continue;
          var text = (node.getAttribute("aria-label") || node.innerText || "").replace(/\\s+/g, " ").trim();
          if (!text || text.length > 80 || seen[text]) continue;
          seen[text] = true;
          out.push({
            value: node.getAttribute("data-value") || node.getAttribute("value") || text,
            label: text,
          });
        }
        return out;
      })()`,
    });
    await session.detach().catch(() => undefined);
    const value = result?.value;
    return Array.isArray(value) ? (value as LiveSelectOption[]) : [];
  } catch {
    return [];
  } finally {
    if (marked) {
      await root
        .evaluate((el) => (el as { removeAttribute(name: string): void }).removeAttribute("data-cm-list"))
        .catch(() => undefined);
    }
  }
}

async function readPointerRows(page: Page, root: PwLocator): Promise<LiveSelectOption[]> {
  const own = await readOwnPointerRows(root);
  if (own.length > 0) return dropCompositeRows(own);
  return dropCompositeRows(await readCdpListenerRows(page, root));
}

async function readOpenTypeaheadOptions(
  loc: PwLocator,
  page: Page,
  listeners = false,
): Promise<LiveSelectOption[]> {
  const root = await boundRoot(loc, page);
  const roles = await readRoleListOptions(root, true);
  if (roles.length > 0) return roles;
  // Hidden `<li role=option>` are not painted. Counting them skips search-on-type probe.
  const kids = await readActableRows(root.locator(":scope > *:visible"));
  if (kids.length > 0) return kids;
  if (!listeners) return [];
  return readPointerRows(page, root);
}

async function listOpened(loc: PwLocator, page: Page): Promise<boolean> {
  const peek = listedPeekMs(page);
  const expanded = ((await loc.getAttribute("aria-expanded", { timeout: peek }).catch(() => null)) ?? "").toLowerCase();
  if (expanded === "true") return true;
  const root = await boundRoot(loc, page);
  return root.first().isVisible({ timeout: peek }).catch(() => false);
}

/** Leading numeric code (`111110 — …`), else the first word a search can use. */
export function optionSearchQuery(opt: LiveSelectOption): string {
  const raw = (opt.label || opt.value).replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const code = raw.match(/^[0-9]{3,}/);
  if (code) return code[0];
  const token = raw.split(/[\s/—,–()]+/).find((t) => t.length >= 3);
  return token || raw;
}

/** Open list: click a match, else a listed row. Empty list means probe next. */
export function pickOpenTypeahead(
  options: readonly LiveSelectOption[],
  wanted: string,
): { pick: LiveSelectOption; matched: boolean } | undefined {
  if (options.length === 0) return undefined;
  const matched = matchListedOption(options, wanted);
  if (matched) return { pick: matched, matched: true };
  const pick = pickListedOption(options, wanted);
  return pick ? { pick, matched: false } : undefined;
}

/** Match first, then ranked records (skip group chrome). Click these in order until one sticks. */
export function listedPicksToTry(
  options: readonly LiveSelectOption[],
  wanted: string,
): LiveSelectOption[] {
  const ordered: LiveSelectOption[] = [];
  const seen = new Set<string>();
  const push = (o?: LiveSelectOption) => {
    if (!o) return;
    const k = `${o.label}\0${o.value}`;
    if (seen.has(k)) return;
    seen.add(k);
    ordered.push(o);
  };
  push(pickOpenTypeahead(options, wanted)?.pick);
  for (const o of rankListedOptions(options)) push(o);
  return ordered.slice(0, MAX_LISTED_CLICKS);
}

/** Poll harvest until rows appear, or the wait budget is gone. */
export async function pollListedOptions(
  read: () => Promise<LiveSelectOption[]>,
  timeoutMs: number,
  clock?: { now(): number; sleep(ms: number): Promise<void> },
): Promise<LiveSelectOption[]> {
  const now = clock?.now ?? Date.now;
  const sleep = clock?.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const deadline = now() + timeoutMs;
  for (;;) {
    const listed = await read();
    if (listed.length > 0) return listed;
    const remaining = deadline - now();
    if (remaining <= 0) return [];
    await sleep(Math.min(TYPEAHEAD_POLL_MS, remaining));
  }
}

async function waitForOptions(
  loc: PwLocator,
  page: Page,
  timeoutMs = TYPEAHEAD_SEARCH_WAIT_MS,
): Promise<LiveSelectOption[]> {
  return pollListedOptions(() => readOpenTypeaheadOptions(loc, page, false), timeoutMs);
}

async function closeTypeahead(loc: PwLocator, page: Page, timeoutMs?: number): Promise<void> {
  const deadline = Date.now() + Math.max(0, timeoutMs ?? actionTimeoutMs(page));
  const ms = sliceTimeoutMs(deadline, { cap: LISTED_CLICK_MS });
  if (ms <= 0) return;
  await loc.press("Escape", { timeout: ms }).catch(() => undefined);
  const hide = Math.min(400, remainingTimeoutMs(deadline));
  if (hide > 0) {
    await (await boundRoot(loc, page)).waitFor({ state: "hidden", timeout: hide }).catch(() => undefined);
  }
}

/** Click to open. Do not ArrowDown — a virtual list that has not painted can hang the page. */
async function openTypeaheadList(
  loc: PwLocator,
  page: Page,
  timeoutMs = TYPEAHEAD_SEARCH_WAIT_MS,
): Promise<LiveSelectOption[]> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  const clickMs = sliceTimeoutMs(deadline);
  if (clickMs <= 0) return [];
  await loc.click({ timeout: clickMs }).catch(() => undefined);
  const painted = await waitForOptions(loc, page, Math.min(MIN_LIST_WAIT_MS, remainingTimeoutMs(deadline)));
  if (painted.length > 0) return painted;
  // Empty open list: probe SEARCH_PROBES next. Do not sit for the rest of `--timeout`.
  return [];
}

function budgetLeft(deadline: number): number {
  return remainingTimeoutMs(deadline);
}

async function searchTypeahead(
  loc: PwLocator,
  page: Page,
  query: string,
  timeoutMs: number,
): Promise<LiveSelectOption[]> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  const clearMs = sliceTimeoutMs(deadline);
  if (clearMs <= 0) return [];
  await loc.fill("", { timeout: clearMs }).catch(() => undefined);
  const typeMs = sliceTimeoutMs(deadline);
  if (typeMs <= 0) return [];
  await loc.fill(query, { timeout: typeMs }).catch(() => undefined);
  return waitForOptions(loc, page, remainingTimeoutMs(deadline));
}

async function probeTypeahead(
  loc: PwLocator,
  page: Page,
  keepQuery: boolean,
  deadline: number,
  wanted?: string,
): Promise<LiveSelectOption[]> {
  for (const probe of listedSearchQueries(wanted)) {
    const left = Math.min(MIN_LIST_WAIT_MS, budgetLeft(deadline));
    if (left <= 0) break;
    const found = await searchTypeahead(loc, page, probe, left);
    if (found.length > 0) {
      if (!keepQuery) {
        const clearMs = budgetLeft(deadline);
        if (clearMs > 0) await loc.fill("", { timeout: clearMs }).catch(() => undefined);
      }
      return found;
    }
  }
  if (!keepQuery) {
    const clearMs = budgetLeft(deadline);
    if (clearMs > 0) await loc.fill("", { timeout: clearMs }).catch(() => undefined);
  }
  return [];
}

/** Snapshot listed rows, then close. Fill uses the same open/probe helpers. Peek must not call this. */
export async function harvestTypeaheadOptions(loc: PwLocator, page: Page): Promise<LiveSelectOption[]> {
  const kind = await typeaheadKindOf(loc, listedPeekMs(page));
  if (kind === "none") return [];
  const staticOpts = await readTypeaheadOptions(loc, page);
  if (kind === "datalist" || staticOpts.length > 0) return staticOpts;
  const deadline = actionDeadline(page);
  const openWait = Math.min(typeaheadListWaitMs(page), budgetLeft(deadline));
  let opts = openWait > 0 ? await openTypeaheadList(loc, page, openWait) : [];
  if (opts.length === 0 && budgetLeft(deadline) > 0) opts = await readOpenTypeaheadOptions(loc, page, true);
  if (opts.length === 0 && budgetLeft(deadline) > 0) {
    opts = await probeTypeahead(loc, page, false, deadline);
  }
  await closeTypeahead(loc, page, budgetLeft(deadline));
  return opts;
}

async function clickNamedOption(root: PwLocator, name: string, timeoutMs: number): Promise<boolean> {
  if (!name || name.length > 80) return false;
  const deadline = Date.now() + Math.max(0, timeoutMs);
  const tries = [
    root.getByRole("option", { name, exact: true }),
    root.getByRole("menuitem", { name, exact: true }),
    root.getByRole("button", { name, exact: true }),
    root.getByText(name, { exact: true }),
  ];
  for (const hit of tries) {
    const left = sliceTimeoutMs(deadline, { cap: LISTED_CLICK_MS, attempts: tries.length });
    if (left <= 0) return false;
    const ok = await hit
      .first()
      .click({ timeout: left, force: true })
      .then(() => true)
      .catch(() => false);
    if (ok) return true;
  }
  return false;
}

async function clickTypeaheadOption(
  loc: PwLocator,
  page: Page,
  match: LiveSelectOption,
  timeoutMs: number,
  wanted?: string,
): Promise<boolean> {
  const root = await boundRoot(loc, page);
  const names = [match.label, match.value, wanted].filter((s): s is string => Boolean(s?.trim()));
  const seen = new Set<string>();
  const deadline = Date.now() + Math.max(0, timeoutMs);
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const left = remainingTimeoutMs(deadline);
    if (left <= 0) return false;
    if (await clickNamedOption(root, name, left)) return true;
  }
  return false;
}

/** Click a painted row by index. Visible first; `force` for virtual lists that are not “visible”. */
async function clickOptionAt(root: PwLocator, index: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  const tries = [
    root.locator('[role="option"]:visible'),
    root.locator('[role="menuitem"]:visible'),
    root.locator('[role="listbox"] button:visible, [role="menu"] button:visible'),
    root.locator(":scope > *:visible"),
    root.locator('[role="option"]'),
    root.locator('[role="menuitem"]'),
    root.locator('[role="listbox"] button, [role="menu"] button'),
    root.locator(":scope > *"),
  ];
  for (const loc of tries) {
    const left = sliceTimeoutMs(deadline, { cap: LISTED_CLICK_MS, attempts: LISTED_CLICK_LOCATOR_COUNT });
    if (left <= 0) return false;
    const n = await loc.count().catch(() => 0);
    if (n === 0) continue;
    const i = Math.min(Math.max(index, 0), n - 1);
    const row = loc.nth(i);
    // Options with pointer-events:none still paint a child span as the hit target.
    const inner = row.locator(":scope *").first();
    const targets = (await inner.count().catch(() => 0)) > 0 ? [inner, row] : [row];
    for (const hit of targets) {
      const ok = await hit
        .click({ timeout: left, force: true })
        .then(() => true)
        .catch(() => false);
      if (ok) return true;
    }
  }
  return false;
}

/** Blank, leftover placeholder, or a Select/Search chip that never got a row. */
export function listedLiveLooksEmpty(live: string, placeholder?: string | null): boolean {
  const v = live.replace(/\s+/g, " ").trim();
  if (!v) return true;
  if (LISTED_CHIP_PROMPT.test(v)) return true;
  const ph = (placeholder ?? "").replace(/\s+/g, " ").trim();
  return Boolean(ph) && v === ph;
}

/** Leftover SEARCH_PROBES query still sitting in the box — not a listed row. */
export function isListedSearchProbe(live: string): boolean {
  const v = live.replace(/\s+/g, " ").trim().toLowerCase();
  return (SEARCH_PROBES as readonly string[]).includes(v);
}

/** True when the control shows a chosen row, not a prompt, probe, or blank. */
export function listedValueIsCommitted(live: string, placeholder?: string | null): boolean {
  if (listedLiveLooksEmpty(live, placeholder)) return false;
  return !isListedSearchProbe(live);
}

/** True when the control shows the listed row, not a leftover 1–2 char probe. */
export function liveLooksLikePick(live: string, pick: LiveSelectOption): boolean {
  const a = live.replace(/\s+/g, " ").trim().toLowerCase();
  if (!a) return false;
  const b = (pick.label || pick.value).replace(/\s+/g, " ").trim().toLowerCase();
  if (!b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return a.length >= 3 && b.length >= 3;
  return false;
}

async function liveInput(loc: PwLocator, timeoutMs = PEEK_TIMEOUT_MS): Promise<string> {
  return (await loc.inputValue({ timeout: timeoutMs }).catch(() => "")).trim();
}

/** Chip/token UIs put the selected label on the combobox, not `input.value`. */
export function typeaheadChipText(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/\bClear\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function readTypeaheadValue(loc: PwLocator, timeoutMs = PEEK_TIMEOUT_MS): Promise<string> {
  const input = await liveInput(loc, timeoutMs);
  if (input) return input;
  const host = await loc
    .evaluate((el) => {
      const n = el as {
        closest(sel: string): { innerText?: string } | null;
        parentElement: { innerText?: string } | null;
        getAttribute(name: string): string | null;
      };
      const ph = (n.getAttribute("placeholder") || "").trim();
      const host = n.closest('[role="combobox"]') || n.parentElement;
      const t = (host?.innerText || "").replace(/\s+/g, " ").trim();
      if (ph && t === ph) return "";
      return t;
    }, undefined, { timeout: timeoutMs })
    .catch(() => "");
  return typeaheadChipText(host);
}

async function selectWithKeyboard(loc: PwLocator, timeoutMs: number): Promise<string | undefined> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  const down = sliceTimeoutMs(deadline, { cap: LISTED_CLICK_MS });
  if (down <= 0) return undefined;
  await loc.press("ArrowDown", { timeout: down }).catch(() => undefined);
  const enter = sliceTimeoutMs(deadline, { cap: LISTED_CLICK_MS });
  if (enter <= 0) return undefined;
  await loc.press("Enter", { timeout: enter }).catch(() => undefined);
  const live = await liveInput(loc);
  return live || undefined;
}

async function commitListed(
  loc: PwLocator,
  pick: LiveSelectOption,
  live: string,
  timeoutMs: number,
): Promise<string> {
  const ms = Math.max(0, timeoutMs);
  if (ms > 0) await loc.press("Escape", { timeout: ms }).catch(() => undefined);
  return live || pick.label || pick.value;
}

async function chooseListedOption(
  loc: PwLocator,
  page: Page,
  shown: LiveSelectOption[],
  wanted: string,
  timeoutMs: number,
): Promise<string | undefined> {
  const picks = listedPicksToTry(shown, wanted);
  if (picks.length === 0) return undefined;
  const root = await boundRoot(loc, page);
  const deadline = Date.now() + Math.max(0, timeoutMs);
  const matched = Boolean(matchListedOption(shown, wanted));
  for (const pick of picks) {
    const ms = sliceTimeoutMs(deadline, { cap: LISTED_CLICK_MS });
    if (ms <= 0) break;
    const idx = shown.findIndex((o) => o.label === pick.label && o.value === pick.value);
    const at = idx < 0 ? 0 : idx;
    // Painted row first — name matching on a virtual list can sit for minutes
    // after the chip is already selected (input.value is empty).
    const peek = listedPeekMs(page);
    if (await clickOptionAt(root, at, ms)) {
      const live = await readTypeaheadValue(loc, peek);
      if (liveLooksLikePick(live, pick)) return commitListed(loc, pick, live, sliceTimeoutMs(deadline, { cap: LISTED_CLICK_MS }));
    }
    const afterPaint = await readTypeaheadValue(loc, peek);
    if (liveLooksLikePick(afterPaint, pick)) {
      return commitListed(loc, pick, afterPaint, sliceTimeoutMs(deadline, { cap: LISTED_CLICK_MS }));
    }
    const namedMs = sliceTimeoutMs(deadline, { cap: LISTED_CLICK_MS });
    if (namedMs <= 0) break;
    if (await clickTypeaheadOption(loc, page, pick, namedMs, matched ? wanted : pick.label)) {
      const named = await readTypeaheadValue(loc, peek);
      if (liveLooksLikePick(named, pick)) return commitListed(loc, pick, named, sliceTimeoutMs(deadline, { cap: LISTED_CLICK_MS }));
    }
    const live = await readTypeaheadValue(loc, peek);
    if (liveLooksLikePick(live, pick)) return commitListed(loc, pick, live, sliceTimeoutMs(deadline, { cap: LISTED_CLICK_MS }));
  }
  const keyedMs = sliceTimeoutMs(deadline, { cap: LISTED_CLICK_MS });
  if (keyedMs > 0) {
    const keyed = await selectWithKeyboard(loc, keyedMs);
    const last = picks[0]!;
    if (keyed && liveLooksLikePick(keyed, last)) return commitListed(loc, last, keyed, keyedMs);
  }
  return undefined;
}

export type TypeaheadFill = { handled: true; failure?: { message: string }; value: string } | { handled: false };

/** Fill a combobox/datalist by choosing a listed option. `handled: false` means use ordinary fill. */
export async function fillTypeahead(
  loc: PwLocator,
  page: Page,
  wanted: string,
  widgetKey: string,
  opts?: { force?: boolean; required?: boolean },
): Promise<TypeaheadFill> {
  const kind = await typeaheadKindOf(loc, listedPeekMs(page));
  if (kind === "none" && !opts?.force) return { handled: false };
  const deadline = actionDeadline(page);
  const act = () => budgetLeft(deadline);
  if (kind === "datalist") {
    const options = await readTypeaheadOptions(loc, page);
    if (options.length === 0) return { handled: false };
    if (wanted === "") {
      const ms = act();
      if (ms > 0) await loc.fill("", { timeout: ms }).catch(() => undefined);
      return { handled: true, value: "" };
    }
    const match = pickListedOption(options, wanted);
    if (!match) {
      return { handled: false };
    }
    const value = match.value || match.label;
    const clearMs = act();
    if (clearMs > 0) await loc.fill("", { timeout: clearMs }).catch(() => undefined);
    const fillMs = act();
    if (fillMs <= 0) return { handled: true, value: "" };
    await loc.fill(value, { timeout: fillMs });
    return { handled: true, value };
  }

  if (wanted === "") {
    const clickMs = act();
    if (clickMs > 0) await loc.click({ timeout: clickMs }).catch(() => undefined);
    const clearMs = act();
    if (clearMs > 0) await loc.fill("", { timeout: clearMs }).catch(() => undefined);
    const escMs = act();
    if (escMs > 0) await loc.press("Escape", { timeout: escMs }).catch(() => undefined);
    return { handled: true, value: "" };
  }

  const already = await readTypeaheadValue(loc, listedPeekMs(page));
  if (
    listedValueIsCommitted(already) &&
    already.toLowerCase().includes(wanted.trim().toLowerCase())
  ) {
    const escMs = act();
    if (escMs > 0) await loc.press("Escape", { timeout: escMs }).catch(() => undefined);
    return { handled: true, value: already };
  }

  const openWait = Math.min(typeaheadListWaitMs(page), act());
  let options = openWait > 0 ? await openTypeaheadList(loc, page, openWait) : [];
  // addEventListener-only rows have no role=option; harvest uses CDP, fill must too.
  if (options.length === 0 && act() > 0 && (await listOpened(loc, page))) {
    options = await readOpenTypeaheadOptions(loc, page, true);
  }
  const clickMs = Math.min(typeaheadListWaitMs(page), act());
  if (clickMs > 0) {
    const fromOpen = await chooseListedOption(loc, page, options, wanted, clickMs);
    if (fromOpen !== undefined) {
      await closeTypeahead(loc, page, act());
      return { handled: true, value: fromOpen };
    }
  }

  // Search-on-type listed chips (Search vendors) stay empty until a short query.
  // Faker multi-word is not that query — SEARCH_PROBES are. A non-listed field
  // that opened empty is still not probed.
  const openedEmpty = options.length === 0 && (await listOpened(loc, page));
  if (
    act() > 0 &&
    shouldProbeListed({
      wanted,
      options,
      force: opts?.force,
      openedEmpty,
    })
  ) {
    options = await probeTypeahead(loc, page, true, deadline, wanted);
    const probeClick = Math.min(typeaheadListWaitMs(page), act());
    if (probeClick > 0) {
      const fromProbe = await chooseListedOption(loc, page, options, wanted, probeClick);
      if (fromProbe !== undefined) {
        await closeTypeahead(loc, page, act());
        return { handled: true, value: fromProbe };
      }
    }
  }

  const live = await readTypeaheadValue(loc, listedPeekMs(page));
  // Typed query is not a pick. The hidden id stays empty until a row is clicked.
  if (options.some((o) => liveLooksLikePick(live, o))) {
    await closeTypeahead(loc, page, act());
    return { handled: true, value: live };
  }

  const clearMs = act();
  if (clearMs > 0) await loc.fill("", { timeout: clearMs }).catch(() => undefined);
  const escMs = act();
  if (escMs > 0) await loc.press("Escape", { timeout: escMs }).catch(() => undefined);
  if (skipTypeaheadNoRows(wanted, options, opts?.force, opts?.required)) {
    return { handled: true, value: "" };
  }
  const label = await typeaheadFieldLabel(loc, widgetKey);
  const message = typeaheadMissMessage({
    widgetKey,
    label,
    wanted,
    options,
  });
  return { handled: true, failure: { message }, value: "" };
}

/** Visible name for a typeahead finding — aria-label / placeholder / field label, else the map id. */
export async function typeaheadFieldLabel(loc: PwLocator, widgetKey: string): Promise<string> {
  const fromDom = await loc
    .evaluate((el) => {
      const n = el as {
        getAttribute(name: string): string | null;
        id?: string;
        ownerDocument: { querySelector(sel: string): { textContent: string | null } | null };
      };
      const aria = (n.getAttribute("aria-label") || "").trim();
      if (aria) return aria;
      const ph = (n.getAttribute("placeholder") || "").trim();
      if (ph) return ph;
      const id = (n.getAttribute("id") || n.id || "").trim();
      if (id) {
        const safe = id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const lab = n.ownerDocument.querySelector(`label[for="${safe}"]`);
        const t = (lab?.textContent || "").replace(/\s+/g, " ").trim();
        if (t) return t;
      }
      return "";
    }, undefined, { timeout: PEEK_TIMEOUT_MS })
    .catch(() => "");
  return (fromDom || widgetKey).replace(/\s+/g, " ").trim();
}

/** Catalog junk is not a listed option. Empty list after that is the control working, not a miss. */
export function skipTypeaheadCatalogMiss(
  wanted: string,
  options: readonly LiveSelectOption[] = [],
): boolean {
  return options.length === 0 && textContainsNastyPayload(wanted);
}

/**
 * Empty list after open: catalog junk, or an optional listed chip with nothing
 * painted. A required listed picker that opened empty is a miss, not success.
 */
export function skipTypeaheadNoRows(
  wanted: string,
  options: readonly LiveSelectOption[] = [],
  force?: boolean,
  required?: boolean,
): boolean {
  if (options.length > 0) return false;
  if (skipTypeaheadCatalogMiss(wanted, options)) return true;
  return Boolean(force) && !required;
}

/**
 * Type 1–2 char probes only when the open list is empty.
 * Single-token wanted (`Alice`, `Norway`) is a search. Multi-word Faker
 * (`beatus bos`) is not — pick a painted row instead of probing the chip.
 */
export function shouldProbeTypeahead(wanted: string, openOptions: readonly LiveSelectOption[]): boolean {
  if (openOptions.length > 0) return false;
  if (skipTypeaheadCatalogMiss(wanted, openOptions)) return false;
  const q = wanted.trim();
  if (q.length <= 2) return true;
  if (/^\d{3,}/.test(q)) return true;
  if (!/\s/.test(q)) return true;
  return false;
}

/**
 * Listed pickers (Search vendors) often paint only after a short query.
 * Faker multi-word is not that query — use SEARCH_PROBES instead.
 * A non-listed chip that opened empty is still not probed.
 */
export function shouldProbeListed(opts: {
  wanted: string;
  options: readonly LiveSelectOption[];
  force?: boolean;
  openedEmpty?: boolean;
}): boolean {
  if (opts.options.length > 0) return false;
  if (skipTypeaheadCatalogMiss(opts.wanted, opts.options)) return false;
  if (opts.force) return true;
  if (opts.openedEmpty) return false;
  return shouldProbeTypeahead(opts.wanted, opts.options);
}

/** Queries actually typed into a listed picker. Never the planned faker phrase. */
export function listedSearchQueries(wanted?: string): readonly string[] {
  const probes = SEARCH_PROBES.slice(0, MAX_PROBES);
  const q = (wanted ?? "").trim();
  if (!q || !shouldProbeTypeahead(q, [])) return probes;
  const token = q.length <= 2 ? q : optionSearchQuery({ value: q, label: q });
  if (!token || probes.some((p) => p.toLowerCase() === token.toLowerCase())) return probes;
  return [token, ...probes];
}

export function typeaheadMissMessage(opts: {
  widgetKey: string;
  label?: string;
  wanted?: string;
  options?: readonly LiveSelectOption[];
}): string {
  const who = (opts.label || opts.widgetKey).replace(/\s+/g, " ").trim() || opts.widgetKey;
  if (opts.options && opts.options.length > 0) {
    return `${who}: could not click a listed option (options: ${formatSelectOptionList(opts.options)})`;
  }
  const q = (opts.wanted ?? "").trim();
  if (q) return `${who}: no matching options for ${JSON.stringify(q)}`;
  return `${who}: the list opened with no options to pick`;
}
