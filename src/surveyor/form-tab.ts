import type { Page } from "playwright";
import type { QualityIssue } from "../schema/quality.js";

/** Form Tab walk — not a full-page session. */
export const MAX_FORM_TABS = 16;
export const STUCK_REPEAT = 3;
/** Consecutive Tab that jumps up more than a row is a 2.4.3 inversion. */
export const FOCUS_ORDER_ROW_PX = 48;
export const MAX_FORM_TAB_HITS = 4;

export type TabStop = {
  name: string;
  where: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export function isStuckTabs(seq: readonly Pick<TabStop, "where">[]): boolean {
  if (seq.length < STUCK_REPEAT) return false;
  const last = seq[seq.length - 1]?.where;
  if (!last) return false;
  let n = 0;
  for (let i = seq.length - 1; i >= 0 && seq[i]?.where === last; i--) n += 1;
  return n >= STUCK_REPEAT;
}

export function isFocusWrap(prev: TabStop, next: TabStop, first: TabStop): boolean {
  return next.where === first.where && prev.where !== first.where;
}

/** Next control sits a row or more above the one we just left. Wrap-around is not this. */
export function isVerticalInversion(prev: TabStop, next: TabStop, first: TabStop): boolean {
  if (isFocusWrap(prev, next, first)) return false;
  return next.y + FOCUS_ORDER_ROW_PX < prev.y;
}

export function keyboardTrapIssue(stop: Pick<TabStop, "name" | "where">): QualityIssue {
  const name = stop.name.replace(/\s+/g, " ").trim() || "control";
  const where = stop.where.replace(/\s+/g, " ").trim();
  return {
    source: "visual",
    rule: "keyboardTrap",
    severity: "error",
    confidence: "high",
    count: 1,
    where,
    message: `Tab stays on ${name} — cannot move focus away (WCAG 2.1.2)`,
  };
}

export function focusOrderIssue(later: TabStop, earlier: TabStop): QualityIssue {
  const a = later.name.replace(/\s+/g, " ").trim() || "control";
  const b = earlier.name.replace(/\s+/g, " ").trim() || "control";
  return {
    source: "visual",
    rule: "focusOrder",
    severity: "warning",
    confidence: "high",
    count: 1,
    where: later.where,
    message: `${a} receives focus before ${b}, which sits above it (WCAG 2.4.3)`,
  };
}

export function issuesFromTabSeq(seq: readonly TabStop[]): QualityIssue[] {
  if (seq.length === 0) return [];
  if (isStuckTabs(seq)) {
    const stop = seq[seq.length - 1]!;
    return [keyboardTrapIssue(stop)];
  }
  const first = seq[0]!;
  const out: QualityIssue[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < seq.length && out.length < MAX_FORM_TAB_HITS; i++) {
    const prev = seq[i - 1]!;
    const next = seq[i]!;
    if (!isVerticalInversion(prev, next, first)) continue;
    const key = `${next.where}|${prev.where}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(focusOrderIssue(next, prev));
  }
  return out;
}

type LiveStop = TabStop | null;

const HELPERS = `
  function vis(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (el.hidden || el.hasAttribute("hidden")) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
    return true;
  }
  function tabbable(el) {
    if (!vis(el)) return false;
    if (el.tabIndex < 0) return false;
    const tag = (el.tagName || "").toLowerCase();
    if (tag === "a") return Boolean(el.getAttribute("href"));
    if (tag === "input") return String(el.type || "").toLowerCase() !== "hidden";
    if (tag === "select" || tag === "textarea" || tag === "button") return true;
    if (el.isContentEditable) return true;
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role === "button" || role === "textbox" || role === "combobox" || role === "searchbox" || role === "link") {
      return el.tabIndex >= 0 || el.hasAttribute("tabindex");
    }
    return el.tabIndex >= 0;
  }
  function nameOf(el) {
    const acc =
      el.getAttribute("aria-label") ||
      (el.labels && el.labels[0] && el.labels[0].innerText) ||
      el.getAttribute("placeholder") ||
      el.getAttribute("name") ||
      el.getAttribute("title") ||
      (typeof el.innerText === "string" ? el.innerText : "") ||
      el.id ||
      tagOf(el);
    return String(acc || "").replace(/\\s+/g, " ").trim().slice(0, 80);
  }
  function tagOf(el) {
    return (el.tagName || "control").toLowerCase();
  }
  function whereOf(el) {
    const testid = el.getAttribute("data-testid");
    if (testid) return testid;
    if (el.id) return el.id;
    const name = el.getAttribute("name");
    if (name) return name;
    const lab = nameOf(el);
    if (lab) return lab;
    return tagOf(el);
  }
  function stopOf(el) {
    if (!el || el === document.body || el === document.documentElement) return null;
    const r = el.getBoundingClientRect();
    return {
      name: nameOf(el) || tagOf(el),
      where: whereOf(el),
      x: r.left,
      y: r.top,
      w: r.width,
      h: r.height,
    };
  }
  function deepActive() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }
  function formTabbables() {
    const forms = Array.from(document.querySelectorAll("form, [role=form]"));
    const out = [];
    for (const root of forms) {
      const nodes = root.querySelectorAll("a, button, input, select, textarea, [tabindex], [contenteditable=true], [role=button], [role=textbox], [role=combobox]");
      const tabs = [];
      for (const n of nodes) {
        if (tabbable(n)) tabs.push(n);
      }
      if (tabs.length >= 2) out.push({ root: root, tabs: tabs });
    }
    return out;
  }
`;

function inPage(body: string): string {
  return `(() => { ${HELPERS}\n${body}\n })()`;
}

export async function formTabReady(page: Page): Promise<boolean> {
  try {
    return Boolean(await page.evaluate(inPage("return formTabbables().length > 0;")));
  } catch {
    return false;
  }
}

async function readActive(page: Page): Promise<LiveStop> {
  const raw = await page.evaluate(inPage("return stopOf(deepActive());"));
  if (!raw || typeof raw !== "object") return null;
  const s = raw as TabStop;
  if (!s.where) return null;
  return s;
}

async function focusFirstFormTab(page: Page): Promise<LiveStop> {
  const raw = await page.evaluate(
    inPage(`
      const packs = formTabbables();
      const first = packs[0] && packs[0].tabs[0];
      if (!first || typeof first.focus !== "function") return null;
      first.focus();
      return stopOf(first);
    `),
  );
  if (!raw || typeof raw !== "object") return null;
  const s = raw as TabStop;
  if (!s.where) return null;
  return s;
}

/** Tab through a form (not the whole page). Empty when there is no 2-field form. */
export async function scanFormTab(page: Page): Promise<QualityIssue[]> {
  if (!(await formTabReady(page))) return [];
  const scroll = (await page
    .evaluate(`({ x: window.scrollX || 0, y: window.scrollY || 0 })`)
    .catch(() => ({ x: 0, y: 0 }))) as { x: number; y: number };
  const sx = Number.isFinite(scroll.x) ? scroll.x : 0;
  const sy = Number.isFinite(scroll.y) ? scroll.y : 0;
  try {
    const first = await focusFirstFormTab(page);
    if (!first) return [];
    const seq: TabStop[] = [first];
    for (let i = 0; i < MAX_FORM_TABS; i++) {
      await page.keyboard.press("Tab");
      const stop = await readActive(page);
      if (!stop) break;
      seq.push(stop);
      if (isStuckTabs(seq)) break;
    }
    return issuesFromTabSeq(seq);
  } catch {
    return [];
  } finally {
    await page.evaluate(`window.scrollTo(${sx}, ${sy})`).catch(() => undefined);
    await page.evaluate(`document.activeElement && document.activeElement.blur && document.activeElement.blur()`).catch(
      () => undefined,
    );
  }
}
