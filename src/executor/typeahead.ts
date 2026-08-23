import type { Locator as PwLocator, Page } from "playwright";
import {
  formatSelectOptionList,
  matchListedOption,
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

/** Options currently attached to this control (listbox, owns, datalist). */
export async function readTypeaheadOptions(loc: PwLocator, page: Page): Promise<LiveSelectOption[]> {
  const ids = await boundListIds(loc.first());
  for (const id of ids) {
    const root = page.locator(idSelector(id));
    const native = await root
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
    if (native.length > 0) return native;
    const roles = await root
      .locator('[role="option"]')
      .evaluateAll((els) =>
        els.flatMap((el) => {
          const o = el as {
            getAttribute(name: string): string | null;
            textContent: string | null;
            innerText?: string;
          };
          if (o.getAttribute("aria-disabled") === "true") return [];
          const text = (o.getAttribute("aria-label") || o.innerText || o.textContent || "")
            .replace(/\s+/g, " ")
            .trim();
          if (!text) return [];
          return [{ value: o.getAttribute("data-value") || o.getAttribute("value") || text, label: text }];
        }),
      )
      .catch(() => [] as LiveSelectOption[]);
    if (roles.length > 0) return roles;
  }
  if (ids.length > 0) return [];
  const visible = page.locator('[role="listbox"]:visible [role="option"]:visible');
  return visible
    .evaluateAll((els) =>
      els.flatMap((el) => {
        const o = el as { innerText: string; getAttribute(name: string): string | null };
        const text = (o.getAttribute("aria-label") || o.innerText || "").replace(/\s+/g, " ").trim();
        if (!text) return [];
        return [{ value: o.getAttribute("data-value") || o.getAttribute("value") || text, label: text }];
      }),
    )
    .catch(() => []);
}

async function readOpenTypeaheadOptions(loc: PwLocator, page: Page): Promise<LiveSelectOption[]> {
  const vis = await page
    .locator('[role="listbox"]:visible [role="option"]:visible')
    .evaluateAll((els) =>
      els.flatMap((el) => {
        const o = el as { innerText: string; getAttribute(name: string): string | null };
        if (o.getAttribute("aria-disabled") === "true") return [];
        const text = (o.getAttribute("aria-label") || o.innerText || "").replace(/\s+/g, " ").trim();
        if (!text) return [];
        return [{ value: o.getAttribute("data-value") || o.getAttribute("value") || text, label: text }];
      }),
    )
    .catch(() => [] as LiveSelectOption[]);
  if (vis.length > 0) return vis;
  return readTypeaheadOptions(loc, page);
}

async function waitForOptions(page: Page, timeoutMs = TYPEAHEAD_OPEN_WAIT_MS): Promise<void> {
  await page
    .locator('[role="option"]:visible')
    .first()
    .waitFor({ state: "visible", timeout: timeoutMs })
    .catch(() => undefined);
}

async function probeSearch(loc: PwLocator, page: Page): Promise<LiveSelectOption[]> {
  for (const probe of SEARCH_PROBES) {
    await loc.fill("").catch(() => undefined);
    await loc.fill(probe).catch(() => undefined);
    await waitForOptions(page, TYPEAHEAD_SEARCH_WAIT_MS);
    const opts = await readTypeaheadOptions(loc, page);
    if (opts.length > 0) {
      await loc.fill("").catch(() => undefined);
      return opts;
    }
  }
  await loc.fill("").catch(() => undefined);
  return [];
}

export async function harvestTypeaheadOptions(loc: PwLocator, page: Page): Promise<LiveSelectOption[]> {
  const kind = await typeaheadKindOf(loc);
  if (kind === "none") return [];
  const staticOpts = await readTypeaheadOptions(loc, page);
  if (kind === "datalist" || staticOpts.length > 0) return staticOpts;
  await loc.click({ timeout: 800 }).catch(() => undefined);
  await waitForOptions(page);
  let opts = await readTypeaheadOptions(loc, page);
  if (opts.length === 0) {
    await loc.press("ArrowDown").catch(() => undefined);
    await waitForOptions(page);
    opts = await readTypeaheadOptions(loc, page);
  }
  if (opts.length === 0) opts = await probeSearch(loc, page);
  await loc.press("Escape").catch(() => undefined);
  await page.locator('[role="listbox"]:visible').first().waitFor({ state: "hidden", timeout: 400 }).catch(() => undefined);
  return opts;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function clickNamedOption(page: Page, name: string): Promise<boolean> {
  if (!name) return false;
  const exact = page.getByRole("option", { name, exact: true });
  if ((await exact.count()) > 0) {
    await exact.first().click();
    return true;
  }
  const prefix = page.getByRole("option", { name: new RegExp(`^${escapeRe(name)}`, "i") });
  if ((await prefix.count()) > 0) {
    await prefix.first().click();
    return true;
  }
  const token = page.getByRole("option", {
    name: new RegExp(`(?:^|[^A-Za-z0-9])${escapeRe(name)}(?:[^A-Za-z0-9]|$)`, "i"),
  });
  if ((await token.count()) > 0) {
    await token.first().click();
    return true;
  }
  return false;
}

async function clickTypeaheadOption(
  page: Page,
  match: LiveSelectOption,
  wanted?: string,
): Promise<boolean> {
  const names = [match.label, match.value, wanted].filter((s): s is string => Boolean(s?.trim()));
  const seen = new Set<string>();
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (await clickNamedOption(page, name)) return true;
  }
  return false;
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
    const match = matchListedOption(options, wanted);
    if (!match) {
      return { handled: false };
    }
    const value = match.value || match.label;
    await loc.fill("");
    await loc.fill(value);
    return { handled: true, value };
  }

  await loc.click({ timeout: 2_000 }).catch(() => undefined);
  if (wanted === "") {
    await loc.fill("");
    await loc.press("Escape").catch(() => undefined);
    return { handled: true, value: "" };
  }
  await loc.fill("");
  await loc.fill(wanted);
  await waitForOptions(page, TYPEAHEAD_SEARCH_WAIT_MS);
  let options = await readOpenTypeaheadOptions(loc, page);
  if (options.length === 0) {
    await loc.press("ArrowDown").catch(() => undefined);
    await waitForOptions(page, TYPEAHEAD_SEARCH_WAIT_MS);
    options = await readOpenTypeaheadOptions(loc, page);
  }
  const listedMatch = matchListedOption(options, wanted);
  if (listedMatch && (await clickTypeaheadOption(page, listedMatch, wanted))) {
    const live = await loc.inputValue().catch(() => listedMatch.label || listedMatch.value);
    return { handled: true, value: live };
  }
  let probed: LiveSelectOption[] = [];
  if (options.length === 0) {
    for (const probe of SEARCH_PROBES) {
      await loc.fill("");
      await loc.fill(probe);
      await waitForOptions(page, TYPEAHEAD_SEARCH_WAIT_MS);
      probed = await readOpenTypeaheadOptions(loc, page);
      if (probed.length > 0) break;
    }
  }
  const probeMatch = matchListedOption(probed, wanted);
  if (probeMatch && (await clickTypeaheadOption(page, probeMatch, wanted))) {
    const live = await loc.inputValue().catch(() => probeMatch.label || probeMatch.value);
    return { handled: true, value: live };
  }
  if (options.length > 0 || probed.length > 0) {
    await loc.fill("");
    await loc.fill(wanted);
    const shown = options.length > 0 ? options : probed;
    return {
      handled: true,
      value: wanted,
      failure: {
        message: `typeahead ${widgetKey} could not click a listed option for ${JSON.stringify(wanted)} (options: ${formatSelectOptionList(shown)})`,
      },
    };
  }
  await loc.fill("");
  await loc.fill(wanted);
  return { handled: true, value: wanted };
}
