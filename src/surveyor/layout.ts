import type { Page } from "playwright";
import { mergeQualityIssues, type QualityIssue } from "../schema/quality.js";
import { scanBroken } from "./broken.js";
import { scanDeadHash } from "./dead-hash.js";
import { scanFocusObscured } from "./focus-obscured.js";
import { scanFocusVisible, type FocusVisibleClip } from "./focus-visible.js";
import { scanFormTab } from "./form-tab.js";
import { scanFontSize } from "./font-size.js";
import { scanImplicitSubmit } from "./implicit-submit.js";
import { scanAdornmentClip } from "./adornment-clip.js";
import { scanFormScanline } from "./form-scanline.js";
import { scanListScanline } from "./list-scanline.js";
import { scanTabScanline } from "./tab-scanline.js";
import { scanNoopener } from "./noopener.js";
import { scanOverlap } from "./overlap.js";
import {
  isReflowDocumentLeak,
  pageWidthOverflowPx,
  scanOverflow,
  scanOverflowMobile,
  scanOverflowReflow,
} from "./overflow.js";
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

async function runFocusVisible(
  page: Page,
): Promise<{ issues: QualityIssue[]; clips: FocusVisibleClip[] } | undefined> {
  try {
    const scanned = await scanFocusVisible(page);
    if (!scanned || !Array.isArray(scanned.issues)) return undefined;
    return { issues: scanned.issues, clips: Array.isArray(scanned.clips) ? scanned.clips : [] };
  } catch {
    return undefined;
  }
}

export type LayoutScan = {
  issues: QualityIssue[];
  complete: boolean;
  focusVisibleClips?: FocusVisibleClip[];
};

/**
 * DOM layout extras (no VLM). Serial on one Playwright page. Focus, then
 * text-spacing, then 375/320 overflow; scroll is restored after those.
 * `complete` is false if any scanner threw — callers must not replaceDom.
 */
export async function scanLayout(page: Page): Promise<LayoutScan> {
  const issues: QualityIssue[] = [];
  let complete = true;
  let focusVisibleClips: FocusVisibleClip[] = [];
  const take = async (scan: (page: Page) => Promise<QualityIssue[]>): Promise<void> => {
    const hits = await runScan(scan, page);
    if (hits === undefined) complete = false;
    else {
      for (const hit of hits) {
        if (!hit.via) hit.via = "dom";
      }
      issues.push(...hits);
    }
  };
  for (const scan of [
    scanTableLayout,
    scanOverflow,
    scanBroken,
    scanTextClip,
    scanOverlap,
    scanListScanline,
    scanTabScanline,
    scanFormScanline,
    scanAdornmentClip,
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
  {
    const hits = await runFocusVisible(page);
    if (hits === undefined) complete = false;
    else {
      for (const hit of hits.issues) {
        if (!hit.via) hit.via = "dom";
      }
      issues.push(...hits.issues);
      if (hits.clips.length > 0) focusVisibleClips = hits.clips;
    }
  }
  await take(scanFormTab);
  const unspaced = issues.filter((i) => i.rule === "clip" || i.rule === "overflow");
  await take((p) => scanTextSpacing(p, unspaced));
  const desktopPagePx = issues
    .map((i) => (i.rule === "overflow" ? pageWidthOverflowPx(i.message) : undefined))
    .find((px) => px !== undefined);
  await take(scanOverflowMobile);
  await take(async (p) => {
    const hits = await scanOverflowReflow(p);
    return hits.filter((h) => {
      const px = pageWidthOverflowPx(h.message);
      if (px === undefined) return true;
      return isReflowDocumentLeak(desktopPagePx, px);
    });
  });
  if (prevView) await page.setViewportSize(prevView).catch(() => undefined);
  await page.evaluate(`window.scrollTo(${sx}, ${sy})`).catch(() => undefined);
  return {
    issues: mergeQualityIssues(issues).map((i) => ({ ...i, via: "dom" as const })),
    complete,
    ...(focusVisibleClips.length > 0 ? { focusVisibleClips } : {}),
  };
}
