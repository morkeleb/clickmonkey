import type { Locator as PwLocator, Page } from "playwright";
import {
  formatSelectOptionList,
  matchListedOption,
  pickListedOption,
  type LiveSelectOption,
} from "./select-options.js";

export type TypeaheadKind = "none" | "datalist" | "combobox";

export async function typeaheadKindOf(loc: PwLocator): Promise<TypeaheadKind> {
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
      return "none";
    })
    .catch(() => "none" as const);
}

export async function looksLikeTypeahead(loc: PwLocator): Promise<boolean> {
  return (await typeaheadKindOf(loc)) !== "none";
}

/** Wait long enough for a debounced server search plus one round trip. */
export const TYPEAHEAD_SEARCH_WAIT_MS = 2500;
const TYPEAHEAD_OPEN_WAIT_MS = 500;
const SEARCH_PROBES = ["a", "e", "s"] as const;

function splitIds(raw: string | null | undefined): string[] {
  return (raw ?? "").trim().split(/\s+/).filter(Boolean);
}

async function boundListIds(loc: PwLocator): Promise<string[]> {
  const el = loc.first();
  const fromSelf = [
    await el.getAttribute("aria-controls").catch(() => null),
    await el.getAttribute("aria-owns").catch(() => null),
    await el.getAttribute("list").catch(() => null),
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
    })
    .catch(() => [] as string[]);
}

function idSelector(id: string): string {
  return `[id=${JSON.stringify(id)}]`;
}

async function boundRoot(loc: PwLocator, page: Page): Promise<PwLocator> {
  const ids = await boundListIds(loc.first());
  if (ids.length === 0) return page.locator('[role="listbox"], [role="menu"]');
  return page.locator(ids.map(idSelector).join(", "));
}

async function readNativeListOptions(root: PwLocator): Promise<LiveSelectOption[]> {
  return root
    .locator("option")
    .evaluateAll((els) =>
      els.flatMap((el) => {
        const o = el as { disabled: boolean; value: string; label: string; textContent: string | null };
        if (o.disabled) return [];
        const value = (o.value || "").trim();
        const label = (o.label || o.textContent || value).trim();
        if (!value && !label) return [];
        return [{ value, label: label || value }];
      }),
    )
    .catch(() => [] as LiveSelectOption[]);
}

async function readRoleListOptions(root: PwLocator, visible: boolean): Promise<LiveSelectOption[]> {
  const loc = visible ? root.locator('[role="option"]:visible') : root.locator('[role="option"]');
  const roles = await loc
    .evaluateAll((els) =>
      els.flatMap((el) => {
        const o = el as {
          getAttribute(name: string): string | null;
          textContent: string | null;
          innerText?: string;
        };
        if (o.getAttribute("aria-disabled") === "true") return [];
        const text = (o.getAttribute("aria-label") || o.innerText || o.textContent || "").replace(/\s+/g, " ").trim();
        if (!text) return [];
        return [{ value: o.getAttribute("data-value") || o.getAttribute("value") || text, label: text }];
      }),
    )
    .catch(() => [] as LiveSelectOption[]);
  if (roles.length > 0) return roles;
  const extra = visible
    ? root.locator('[role="menuitem"]:visible, button:visible')
    : root.locator('[role="menuitem"], button');
  return extra
    .evaluateAll((els) =>
      els.flatMap((el) => {
        const o = el as {
          getAttribute(name: string): string | null;
          textContent: string | null;
          innerText?: string;
        };
        if (o.getAttribute("aria-disabled") === "true") return [];
        const type = (o.getAttribute("type") || "").toLowerCase();
        if (type === "submit" || type === "reset") return [];
        const text = (o.getAttribute("aria-label") || o.innerText || o.textContent || "").replace(/\s+/g, " ").trim();
        if (!text) return [];
        return [{ value: o.getAttribute("data-value") || o.getAttribute("value") || text, label: text }];
      }),
    )
    .catch(() => [] as LiveSelectOption[]);
}

/** Options currently attached to this control (listbox, owns, datalist). */
export async function readTypeaheadOptions(loc: PwLocator, page: Page): Promise<LiveSelectOption[]> {
  const ids = await boundListIds(loc.first());
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
  return root
    .evaluate((el) => {
      function own(node: {
        onclick?: unknown;
        onmousedown?: unknown;
        onpointerdown?: unknown;
        getAttribute?(name: string): string | null;
      }): boolean {
        if (node.onclick || node.onmousedown || node.onpointerdown) return true;
        if (node.getAttribute?.("onclick") || node.getAttribute?.("onmousedown")) return true;
        for (const k of Object.keys(node)) {
          if (!k.startsWith("__reactProps") && !k.startsWith("__reactEventHandlers")) continue;
          const p = (node as Record<string, { onClick?: unknown; onMouseDown?: unknown; onPointerDown?: unknown }>)[k];
          if (p && (p.onClick || p.onMouseDown || p.onPointerDown)) return true;
        }
        return false;
      }
      const rootEl = el as {
        querySelectorAll(sel: string): Iterable<{
          getAttribute(name: string): string | null;
          innerText?: string;
          onclick?: unknown;
          onmousedown?: unknown;
          onpointerdown?: unknown;
        }>;
      };
      const out: { value: string; label: string }[] = [];
      const seen: Record<string, boolean> = {};
      for (const node of rootEl.querySelectorAll("*")) {
        if (!own(node)) continue;
        if (node.getAttribute("aria-disabled") === "true") continue;
        const type = (node.getAttribute("type") || "").toLowerCase();
        if (type === "submit" || type === "reset") continue;
        const text = (node.getAttribute("aria-label") || node.innerText || "").replace(/\s+/g, " ").trim();
        if (!text || text.length > 80 || seen[text]) continue;
        seen[text] = true;
        out.push({
          value: node.getAttribute("data-value") || node.getAttribute("value") || text,
          label: text,
        });
      }
      return out;
    })
    .catch(() => [] as LiveSelectOption[]);
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

async function readOpenTypeaheadOptions(loc: PwLocator, page: Page): Promise<LiveSelectOption[]> {
  const root = await boundRoot(loc, page);
  const roles = await readRoleListOptions(root, true);
  if (roles.length > 0) return roles;
  return readPointerRows(page, root);
}

/** Leading NAICS-style code, else the first word a search can use. */
export function optionSearchQuery(opt: LiveSelectOption): string {
  const raw = (opt.label || opt.value).replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const code = raw.match(/^[0-9]{3,}/);
  if (code) return code[0];
  const token = raw.split(/[\s/—,–()]+/).find((t) => t.length >= 3);
  return token || raw;
}

/** Open list: click a match, else a listed row. Empty list means type or probe next. */
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

async function waitForOptions(loc: PwLocator, page: Page, timeoutMs = TYPEAHEAD_OPEN_WAIT_MS): Promise<void> {
  const root = await boundRoot(loc, page);
  await root
    .locator('[role="option"]:visible, [role="menuitem"]:visible, button:visible')
    .first()
    .waitFor({ state: "visible", timeout: timeoutMs })
    .catch(() => undefined);
}

async function closeTypeahead(loc: PwLocator, page: Page): Promise<void> {
  await loc.press("Escape").catch(() => undefined);
  await (await boundRoot(loc, page)).waitFor({ state: "hidden", timeout: 400 }).catch(() => undefined);
}

/** Click, clear, ArrowDown — harvest and fill use this, not a second open path. */
async function openTypeaheadList(loc: PwLocator, page: Page): Promise<LiveSelectOption[]> {
  await loc.click({ timeout: 2_000 }).catch(() => undefined);
  await loc.fill("").catch(() => undefined);
  await loc.press("ArrowDown").catch(() => undefined);
  await waitForOptions(loc, page, TYPEAHEAD_OPEN_WAIT_MS);
  return readOpenTypeaheadOptions(loc, page);
}

async function searchTypeahead(loc: PwLocator, page: Page, query: string): Promise<LiveSelectOption[]> {
  await loc.fill("").catch(() => undefined);
  await loc.fill(query).catch(() => undefined);
  await waitForOptions(loc, page, TYPEAHEAD_SEARCH_WAIT_MS);
  return readOpenTypeaheadOptions(loc, page);
}

async function probeTypeahead(loc: PwLocator, page: Page, keepQuery: boolean): Promise<LiveSelectOption[]> {
  for (const probe of SEARCH_PROBES) {
    const found = await searchTypeahead(loc, page, probe);
    if (found.length > 0) {
      if (!keepQuery) await loc.fill("").catch(() => undefined);
      return found;
    }
  }
  if (!keepQuery) await loc.fill("").catch(() => undefined);
  return [];
}

/** Snapshot listed rows, then close. Fill uses the same open/probe helpers. */
export async function harvestTypeaheadOptions(loc: PwLocator, page: Page): Promise<LiveSelectOption[]> {
  const kind = await typeaheadKindOf(loc);
  if (kind === "none") return [];
  const staticOpts = await readTypeaheadOptions(loc, page);
  if (kind === "datalist" || staticOpts.length > 0) return staticOpts;
  let opts = await openTypeaheadList(loc, page);
  if (opts.length === 0) opts = await probeTypeahead(loc, page, false);
  await closeTypeahead(loc, page);
  return opts;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function clickNamedOption(root: PwLocator, name: string): Promise<boolean> {
  if (!name) return false;
  const token = new RegExp(`(?:^|[^A-Za-z0-9])${escapeRe(name)}(?:[^A-Za-z0-9]|$)`, "i");
  const prefix = new RegExp(`^${escapeRe(name)}`, "i");
  const tries = [
    root.getByRole("option", { name, exact: true }),
    root.getByRole("menuitem", { name, exact: true }),
    root.getByRole("button", { name, exact: true }),
    root.getByRole("option", { name: prefix }),
    root.getByRole("menuitem", { name: prefix }),
    root.getByRole("button", { name: prefix }),
    root.getByRole("option", { name: token }),
    root.getByRole("menuitem", { name: token }),
    root.getByRole("button", { name: token }),
    root.getByText(name, { exact: true }),
  ];
  for (const hit of tries) {
    if ((await hit.count().catch(() => 0)) === 0) continue;
    const ok = await hit
      .first()
      .click({ timeout: 2_000 })
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
  wanted?: string,
): Promise<boolean> {
  const root = await boundRoot(loc, page);
  const names = [match.label, match.value, wanted].filter((s): s is string => Boolean(s?.trim()));
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (await clickNamedOption(root, name)) return true;
  }
  return false;
}

async function liveInput(loc: PwLocator): Promise<string> {
  return (await loc.inputValue().catch(() => "")).trim();
}

async function selectWithKeyboard(loc: PwLocator): Promise<string | undefined> {
  await loc.press("ArrowDown").catch(() => undefined);
  await loc.press("Enter").catch(() => undefined);
  const live = await liveInput(loc);
  return live || undefined;
}

async function chooseListedOption(
  loc: PwLocator,
  page: Page,
  shown: LiveSelectOption[],
  wanted: string,
): Promise<string | undefined> {
  const hit = pickOpenTypeahead(shown, wanted);
  if (!hit) return undefined;
  if (await clickTypeaheadOption(loc, page, hit.pick, hit.matched ? wanted : undefined)) {
    const live = await liveInput(loc);
    if (live) {
      await loc.press("Escape").catch(() => undefined);
      return live;
    }
  }
  const keyed = await selectWithKeyboard(loc);
  if (keyed) {
    await loc.press("Escape").catch(() => undefined);
    return keyed;
  }
  const query = optionSearchQuery(hit.pick);
  if (!query) return undefined;
  await searchTypeahead(loc, page, query);
  if (await clickTypeaheadOption(loc, page, hit.pick)) {
    const live = await liveInput(loc);
    if (live) {
      await loc.press("Escape").catch(() => undefined);
      return live;
    }
  }
  const afterSearch = await selectWithKeyboard(loc);
  if (afterSearch) {
    await loc.press("Escape").catch(() => undefined);
    return afterSearch;
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
): Promise<TypeaheadFill> {
  const kind = await typeaheadKindOf(loc);
  if (kind === "none") return { handled: false };
  if (kind === "datalist") {
    const options = await readTypeaheadOptions(loc, page);
    if (options.length === 0) return { handled: false };
    if (wanted === "") {
      await loc.fill("");
      return { handled: true, value: "" };
    }
    const match = pickListedOption(options, wanted);
    if (!match) {
      return { handled: false };
    }
    const value = match.value || match.label;
    await loc.fill("");
    await loc.fill(value);
    return { handled: true, value };
  }

  if (wanted === "") {
    await loc.click({ timeout: 2_000 }).catch(() => undefined);
    await loc.fill("");
    await loc.press("Escape").catch(() => undefined);
    return { handled: true, value: "" };
  }

  let options = await openTypeaheadList(loc, page);
  const fromOpen = await chooseListedOption(loc, page, options, wanted);
  if (fromOpen !== undefined) return { handled: true, value: fromOpen };

  if (options.length === 0) {
    options = await searchTypeahead(loc, page, wanted);
    const fromWanted = await chooseListedOption(loc, page, options, wanted);
    if (fromWanted !== undefined) return { handled: true, value: fromWanted };
  }

  if (options.length === 0) {
    options = await probeTypeahead(loc, page, true);
    const fromProbe = await chooseListedOption(loc, page, options, wanted);
    if (fromProbe !== undefined) return { handled: true, value: fromProbe };
  }

  if (options.length > 0) {
    return {
      handled: true,
      value: wanted,
      failure: {
        message: `typeahead ${widgetKey} could not click a listed option (options: ${formatSelectOptionList(options)})`,
      },
    };
  }
  await loc.fill("").catch(() => undefined);
  await loc.press("Escape").catch(() => undefined);
  return { handled: true, value: "" };
}
