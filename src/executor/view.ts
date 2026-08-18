import type { Locator as PwLocator, Page } from "playwright";
import { locatorOf } from "../schema/locator.js";
import type { Field, PageModel, PageModelDraft, Surface, Widget } from "../schema/page-model.js";
import type { ShownAction, ShownField, View } from "../schema/view.js";
import {
  dedupeIssues,
  isInsufficient,
} from "../schema/testability.js";
import type { Fence } from "../schema/config.js";
import { auditVisible } from "../surveyor/audit.js";
import { isLeaveAction, matchesSkip } from "../brains/unleash.js";
import { pageNotesFromModel } from "../surveyor/describe.js";
import { hoppablePages } from "./hop.js";
import { formatFont, lookIsEmpty, readLook } from "./look.js";
import {
  toPlaywrightLocator,
  widgetLocator,
  isLiveWidget,
  isPresentWidget,
  pickActable,
  widgetInNav,
} from "./locators.js";

/** Keep the snapshot inside a brain's context. Cut on a line boundary. */
export const CONTENT_MAX = 8000;

async function lookScope(page: Page): Promise<PwLocator> {
  const main = page.locator("main, [role='main']");
  if ((await main.count()) > 0) return main.first();
  return page.locator("body");
}

function currentSurface(
  model: PageModel | PageModelDraft,
  pageId: string,
  surfaceId: string,
): Surface | undefined {
  const page = model.pages.find((p) => p.id === pageId);
  const fromPage = page?.surfaces.find((s) => s.id === surfaceId);
  if (fromPage) return fromPage;
  for (const p of model.pages) {
    const s = p.surfaces.find((x) => x.id === surfaceId);
    if (s) return s;
  }
  return undefined;
}

/** Browser-side. Must stay closure-free for locator.evaluate. */
function readLiveLabel(el: {
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
  if (aria?.trim()) return aria.trim().slice(0, 80);
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => g.document.getElementById(id)?.innerText ?? "")
      .join(" ")
      .trim();
    if (text) return text.slice(0, 80);
  }
  if (el.id) {
    const escaped = g.CSS?.escape(el.id) ?? el.id;
    const t = g.document.querySelector(`label[for="${escaped}"]`)?.innerText.trim() ?? "";
    if (t) return t.slice(0, 80);
  }
  const wrap = el.closest("label")?.innerText.trim() ?? "";
  if (wrap) return wrap.slice(0, 80);
  const own = (el.innerText ?? "").trim();
  return own ? own.slice(0, 80) : "";
}

function slugLabel(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Drop labels that just repeat the id (`submit` / `Submit`). */
export function usefulLabel(id: string, raw: string): string | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  if (slugLabel(t) === id.toLowerCase()) return undefined;
  return t.slice(0, 80);
}

export function clipContent(raw: string): string {
  const t = raw.replace(/\s+$/u, "");
  if (t.length <= CONTENT_MAX) return t;
  const cut = t.slice(0, CONTENT_MAX);
  const lastNl = cut.lastIndexOf("\n");
  return `${lastNl > 0 ? cut.slice(0, lastNl) : cut}\n…`;
}

/** Unique and visible right now. Hidden chrome from an earlier inspect is not legal. */
async function liveActable(
  page: Page,
  surface: Surface | undefined,
  widget: Widget,
): Promise<boolean> {
  return isLiveWidget(widgetLocator(page, surface, locatorOf(widget)), page);
}

async function liveLabel(
  page: Page,
  surface: Surface | undefined,
  widget: Widget,
): Promise<string | undefined> {
  const loc = await pickActable(widgetLocator(page, surface, locatorOf(widget)), page);
  if (!loc) return undefined;
  const raw = await loc.evaluate(readLiveLabel).catch(() => "");
  return usefulLabel(widget.id, raw);
}

async function firstVisibleSnapshot(loc: PwLocator): Promise<string | undefined> {
  if ((await loc.count()) === 0) return undefined;
  const first = loc.first();
  if (!(await first.isVisible().catch(() => false))) return undefined;
  try {
    const snap = await first.ariaSnapshot({ timeout: 1000 });
    const clipped = clipContent(snap);
    return clipped.length > 0 ? clipped : undefined;
  } catch {
    return undefined;
  }
}

async function liveContent(page: Page, surface: Surface | undefined): Promise<string | undefined> {
  if (surface?.locator) {
    const scoped = await firstVisibleSnapshot(toPlaywrightLocator(page, surface.locator));
    if (scoped) return scoped;
  }
  const main = await firstVisibleSnapshot(page.locator("main, [role='main']"));
  if (main) return main;
  return firstVisibleSnapshot(page.locator("body"));
}

async function liveFieldValue(
  page: Page,
  surface: Surface | undefined,
  field: Field,
): Promise<string> {
  const loc = await pickActable(widgetLocator(page, surface, locatorOf(field)), page);
  if (!loc) return "";
  if (field.type === "password") {
    const raw = await loc.inputValue({ timeout: 0 }).catch(() => "");
    return raw ? "••••" : "";
  }
  if (field.type === "checkbox") {
    const checked = await loc.isChecked({ timeout: 0 }).catch(() => false);
    return checked ? "true" : "false";
  }
  return loc.inputValue({ timeout: 0 }).catch(() => "");
}

export async function buildView(state: {
  page: Page;
  pageId: string;
  surfaceStack: string[];
  model: PageModel | PageModelDraft;
  last?: { step: string; ok: boolean; finding?: string };
  /** Leash `url`. Hop targets are this origin only. */
  appUrl?: string;
  fence?: Fence;
  intro?: readonly string[];
  skip?: readonly string[];
}): Promise<View> {
  const stack = state.surfaceStack.length > 0 ? [...state.surfaceStack] : [state.pageId];
  const surfaceId = stack[stack.length - 1] ?? state.pageId;
  const surface = currentSurface(state.model, state.pageId, surfaceId);

  const shown: ShownField[] = [];
  const actions: ShownAction[] = [];

  if (surface) {
    for (const field of surface.fields) {
      if (field.status !== "ok") continue;
      if (!(await liveActable(state.page, surface, field))) continue;
      const value = await liveFieldValue(state.page, surface, field);
      const label = await liveLabel(state.page, surface, field);
      shown.push({
        id: field.id,
        value,
        required: field.required,
        type: field.type,
        ...(label ? { label } : {}),
      });
    }
    for (const action of surface.actions) {
      if (action.status !== "ok") continue;
      if (isLeaveAction(action) || matchesSkip(action, state.skip)) continue;
      if (!(await liveActable(state.page, surface, action))) continue;
      const label = await liveLabel(state.page, surface, action);
      const loc = widgetLocator(state.page, surface, locatorOf(action));
      const inNav = await widgetInNav(loc, state.page);
      actions.push({
        id: action.id,
        ...(action.opens ? { opens: action.opens } : {}),
        ...(label ? { label } : {}),
        ...(inNav ? { nav: true } : {}),
      });
    }
  }

  const content = await liveContent(state.page, surface);
  const auditRoot = surface?.locator
    ? toPlaywrightLocator(state.page, surface.locator)
    : state.page;
  const lookRoot = surface?.locator
    ? toPlaywrightLocator(state.page, surface.locator)
    : await lookScope(state.page);
  const audit = await auditVisible(state.page, auditRoot, {
    excludeVisibleDialogs: surface?.kind !== "dialog",
    checkMain: surface?.kind !== "dialog",
  });

  const widgets: Array<{ id: string; loc: ReturnType<typeof toPlaywrightLocator> }> = [];
  if (surface) {
    for (const w of [...surface.fields, ...surface.actions]) {
      if (w.status !== "ok") continue;
      const loc = widgetLocator(state.page, surface, locatorOf(w));
      if (!(await isPresentWidget(loc, state.page))) continue;
      widgets.push({ id: w.id, loc });
    }
  }
  const look = await readLook({ root: lookRoot, widgets });

  const issues = [...audit.issues];
  if (look.covered.length > 0) {
    issues.push({ code: "occludedWidget", severity: "warn", tag: "widget" });
  }
  const testabilityIssues = dedupeIssues(issues);

  const hopPages = state.appUrl
    ? hoppablePages(state.model.pages, {
        appUrl: state.appUrl,
        fence: state.fence,
        intro: state.intro,
        currentHref: state.page.url(),
      }).map((p) => p.id)
    : state.model.pages.map((p) => p.id);
  const pageNotes = pageNotesFromModel(state.model.pages);

  return {
    page: state.pageId,
    pages: hopPages,
    ...(pageNotes ? { pageNotes } : {}),
    surface: surfaceId,
    stack,
    shown,
    actions,
    ...(!lookIsEmpty(look) ? { look } : {}),
    ...(content ? { content } : {}),
    ...(testabilityIssues.length > 0
      ? { testability: { insufficient: isInsufficient(testabilityIssues), issues: testabilityIssues } }
      : {}),
    ...(state.last ? { last: state.last } : {}),
  };
}

function formatPagesLines(view: View): string[] {
  if (!view.pages || view.pages.length === 0) return [];
  const notes = view.pageNotes;
  if (!notes || Object.keys(notes).length === 0) {
    return [`pages: ${view.pages.join(", ")}`];
  }
  return [
    "pages:",
    ...view.pages.map((id) => {
      const note = notes[id];
      return note ? `  ${id} — ${note}` : `  ${id}`;
    }),
  ];
}

export function formatView(view: View): string {
  const here = view.pageNotes?.[view.page];
  const lines: string[] = [
    here ? `page: ${view.page} — ${here}` : `page: ${view.page}`,
    ...formatPagesLines(view),
    `surface: ${view.surface}`,
    `stack: ${view.stack.join(" > ")}`,
    "shown:",
  ];
  for (const field of view.shown) {
    const flags = [field.required ? "required" : undefined, field.type].filter(Boolean).join(", ");
    const rendered = `  ${field.id}: ${JSON.stringify(field.value)}`;
    const withFlags = flags ? `${rendered}  [${flags}]` : rendered;
    lines.push(field.label ? `${withFlags}  ${field.label}` : withFlags);
  }
  lines.push("actions:");
  for (const action of view.actions) {
    const base = action.opens ? `  ${action.id} → ${action.opens}` : `  ${action.id}`;
    const withLabel = action.label ? `${base}  ${action.label}` : base;
    lines.push(action.nav ? `${withLabel}  [nav]` : withLabel);
  }
  if (view.look && !lookIsEmpty(view.look)) {
    lines.push("look:");
    if (view.look.fonts.length > 0) {
      lines.push(`  fonts: ${view.look.fonts.map(formatFont).join(", ")}`);
    }
    if (view.look.covered.length > 0) {
      lines.push(
        `  covered: ${view.look.covered.map((c) => `${c.id} ← ${c.by}`).join(", ")}`,
      );
    }
  }
  if (view.content) {
    lines.push("content:");
    for (const line of view.content.split("\n")) lines.push(`  ${line}`);
  }
  if (view.testability && view.testability.issues.length > 0) {
    lines.push(`testability: ${view.testability.insufficient ? "insufficient" : "warn"}`);
    const shownIssues = view.testability.issues.slice(0, 20);
    for (const issue of shownIssues) {
      const extra = [issue.role, issue.inputType].filter(Boolean).join(" ");
      lines.push(extra ? `  ${issue.code}  ${issue.tag}  ${extra}` : `  ${issue.code}  ${issue.tag}`);
    }
    if (view.testability.issues.length > shownIssues.length) {
      lines.push(`  … ${view.testability.issues.length - shownIssues.length} more`);
    }
  }
  if (view.last) {
    const outcome = view.last.ok ? "ok" : (view.last.finding ?? "fail");
    lines.push(`last: ${view.last.step} → ${outcome}`);
  }
  return `${lines.join("\n")}\n`;
}
