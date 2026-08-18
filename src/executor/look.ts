import type { Locator as PwLocator } from "playwright";
import type { Look, LookCovered, LookFont } from "../schema/view.js";

export const LOOK_FONT_CAP = 10;

/** First family in a CSS font-family list, quotes stripped. */
export function firstFamily(fontFamily: string): string {
  const first = fontFamily.split(",")[0]?.trim() ?? "";
  return first.replace(/^["']|["']$/g, "").trim();
}

export function normalizeWeight(weight: string): string {
  if (weight === "normal") return "400";
  if (weight === "bold") return "700";
  return weight;
}

/** Keep the common face plus family outliers so explore sees disagreement. */
export function pickFonts(entries: LookFont[], cap = LOOK_FONT_CAP): LookFont[] {
  if (entries.length === 0) return [];
  const sorted = [...entries].sort((a, b) => b.count - a.count || a.family.localeCompare(b.family));
  const mode = sorted[0]!.family;
  const main = sorted.filter((e) => e.family === mode);
  const outliers = sorted.filter((e) => e.family !== mode);
  const mainKeep = Math.min(main.length, Math.max(3, cap - Math.min(outliers.length, 5)));
  return [...main.slice(0, mainKeep), ...outliers.slice(0, cap - mainKeep)];
}

export function formatFont(font: LookFont): string {
  return `${font.family} ${font.size}/${font.weight} (${font.count})`;
}

/** Browser-side. Must stay closure-free for locator.evaluate. */
function readFontHits(root: {
  querySelectorAll(sel: string): ArrayLike<{
    tagName: string;
    checkVisibility?: (opts: { checkOpacity: boolean; checkVisibilityCSS: boolean }) => boolean;
  }>;
  ownerDocument: {
    defaultView: {
      getComputedStyle(el: unknown): { fontFamily: string; fontSize: string; fontWeight: string };
    } | null;
  } | null;
}): Array<{ family: string; size: string; weight: string; count: number }> {
  const win = root.ownerDocument?.defaultView;
  if (!win) return [];
  const nodes = root.querySelectorAll(
    'h1,h2,h3,h4,h5,h6,p,li,label,button,a,input,textarea,select,th,td,[role="button"],[role="link"],[role="heading"]',
  );
  const counts: Record<string, number> = {};
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i]!;
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    }
    const cs = win.getComputedStyle(el);
    const rawFamily = cs.fontFamily.split(",")[0]?.trim() ?? "";
    const family = rawFamily.replace(/^["']|["']$/g, "").trim();
    if (!family) continue;
    let weight = cs.fontWeight;
    if (weight === "normal") weight = "400";
    if (weight === "bold") weight = "700";
    const key = `${family}\0${cs.fontSize}\0${weight}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const out: Array<{ family: string; size: string; weight: string; count: number }> = [];
  for (const [key, count] of Object.entries(counts)) {
    const [family, size, weight] = key.split("\0");
    if (family && size && weight) out.push({ family, size, weight, count });
  }
  return out;
}

type HitResult = { covered: boolean; by?: string };

/** Browser-side. Must stay closure-free for locator.evaluate. */
function readHit(el: {
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  contains(other: unknown): boolean;
  getAttribute(name: string): string | null;
  tagName: string;
  id: string;
  ownerDocument: {
    elementFromPoint(x: number, y: number): {
      contains(other: unknown): boolean;
      getAttribute(name: string): string | null;
      tagName: string;
      id: string;
    } | null;
    defaultView: { innerWidth: number; innerHeight: number } | null;
  };
}): HitResult {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return { covered: false };
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const win = el.ownerDocument.defaultView;
  if (!win || x < 0 || y < 0 || x > win.innerWidth || y > win.innerHeight) {
    return { covered: false };
  }
  const top = el.ownerDocument.elementFromPoint(x, y);
  if (!top) return { covered: false };
  if (el === top || el.contains(top) || top.contains(el)) return { covered: false };
  const testId = top.getAttribute("data-testid")?.trim();
  if (testId) return { covered: true, by: testId.slice(0, 40) };
  if (top.id?.trim()) return { covered: true, by: top.id.trim().slice(0, 40) };
  return { covered: true, by: top.tagName.toLowerCase() };
}

async function sampleFonts(root: PwLocator): Promise<LookFont[]> {
  if ((await root.count()) === 0) return [];
  const raw = await root.first().evaluate(readFontHits).catch(() => []);
  return pickFonts(raw);
}

export async function widgetIsCovered(loc: PwLocator): Promise<boolean> {
  const hit = await hitTest(loc);
  return hit.covered;
}

async function hitTest(loc: PwLocator): Promise<HitResult> {
  const n = await loc.count().catch(() => 0);
  let covered: HitResult | undefined;
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const hit = await el.evaluate(readHit).catch(() => ({ covered: false as const }));
    if (!hit.covered) return { covered: false };
    covered ??= hit;
  }
  return covered ?? { covered: false };
}

export async function readLook(opts: {
  root: PwLocator;
  widgets: Array<{ id: string; loc: PwLocator }>;
}): Promise<Look> {
  const fonts = await sampleFonts(opts.root);
  const covered: LookCovered[] = [];
  for (const widget of opts.widgets) {
    const hit = await hitTest(widget.loc);
    if (hit.covered && hit.by) covered.push({ id: widget.id, by: hit.by });
  }
  return { fonts, covered };
}

export function lookIsEmpty(look: Look): boolean {
  return look.fonts.length === 0 && look.covered.length === 0;
}
