import type { Page } from "playwright";
import { mergeQualityIssues, type QualityIssue } from "../schema/quality.js";
import { scanBroken } from "./broken.js";
import { scanDeadHash } from "./dead-hash.js";
import { scanFocusObscured } from "./focus-obscured.js";
import { scanFocusVisible } from "./focus-visible.js";
import { scanFontSize } from "./font-size.js";
import { scanImplicitSubmit } from "./implicit-submit.js";
import { scanListScanline } from "./list-scanline.js";
import { scanNoopener } from "./noopener.js";
import { scanOverlap } from "./overlap.js";
import { scanOverflow, scanOverflowMobile, scanOverflowReflow } from "./overflow.js";
import { scanPointerEvents } from "./pointer-events.js";
import { scanTableLayout } from "./scanline.js";
import { scanScrollPadding } from "./scroll-padding.js";
import { scanTargetSize } from "./target-size.js";
import { scanTextClip } from "./text-clip.js";
import { scanTextOcclusion } from "./text-occlusion.js";
import { scanTextSpacing } from "./text-spacing.js";

async function runScan(
  scan: (page: Page) => Promise<QualityIssue[]>,
  page: Page,
): Promise<QualityIssue[] | undefined> {
  try {
    const hits = await scan(page);
    return Array.isArray(hits) ? hits : [];
  } catch {
    return undefined;
  }
}

export type LayoutScan = { issues: QualityIssue[]; complete: boolean };

/**
 * DOM layout extras (no VLM). Serial on one Playwright page. Focus, then
 * text-spacing, then 375/320 overflow; scroll is restored after those.
 * `complete` is false if any scanner threw — callers must not replaceDom.
 */
export async function scanLayout(page: Page): Promise<LayoutScan> {
  const issues: QualityIssue[] = [];
  let complete = true;
  const take = async (scan: (page: Page) => Promise<QualityIssue[]>): Promise<void> => {
    const hits = await runScan(scan, page);
    if (hits === undefined) complete = false;
    else issues.push(...hits);
  };
  for (const scan of [
    scanTableLayout,
    scanOverflow,
    scanBroken,
    scanTextClip,
    scanOverlap,
    scanListScanline,
    scanTargetSize,
    scanTextOcclusion,
    scanFontSize,
    scanDeadHash,
    scanImplicitSubmit,
    scanNoopener,
    scanScrollPadding,
    scanPointerEvents,
  ]) {
    await take(scan);
  }
  const prevView = page.viewportSize();
  const scroll = (await page
    .evaluate(`({ x: window.scrollX || 0, y: window.scrollY || 0 })`)
    .catch(() => ({ x: 0, y: 0 }))) as { x: number; y: number };
  const sx = Number.isFinite(scroll.x) ? scroll.x : 0;
  const sy = Number.isFinite(scroll.y) ? scroll.y : 0;
  await take(scanFocusObscured);
  await take(scanFocusVisible);
  await take(scanTextSpacing);
  await take(scanOverflowMobile);
  await take(scanOverflowReflow);
  if (prevView) await page.setViewportSize(prevView).catch(() => undefined);
  await page.evaluate(`window.scrollTo(${sx}, ${sy})`).catch(() => undefined);
  return {
    issues: mergeQualityIssues(issues).map((i) => ({ ...i, via: "dom" as const })),
    complete,
  };
}
