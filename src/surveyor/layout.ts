import type { Page } from "playwright";
import { mergeQualityIssues, type QualityIssue } from "../schema/quality.js";
import { scanBroken } from "./broken.js";
import { scanDeadHash } from "./dead-hash.js";
import { scanFocusObscured } from "./focus-obscured.js";
import { scanFocusVisible, type EvidenceClip, type FocusVisibleClip } from "./focus-visible.js";
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
  type OverflowViewportShotFn,
} from "./overflow.js";
import { scanPointerEvents } from "./pointer-events.js";
import { scanTableLayout } from "./scanline.js";
import { scanScrollPadding } from "./scroll-padding.js";
import { scanTargetSizeEvidence } from "./target-size.js";
import { scanTextClipEvidence } from "./text-clip.js";
import { scanTextOcclusionEvidence } from "./text-occlusion.js";
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
  /** Overflow stills taken at 375/320 before the viewport is restored. */
  overflowShots?: { where: string; screenshotPath: string }[];
  /** Viewport crops for clip / targetSize / textOcclusion. */
  widgetClips?: EvidenceClip[];
};

export type LayoutScanOpts = {
  /** Capture a PNG while the page is still at this overflow width. */
  overflowShot?: (width: number) => Promise<string | undefined>;
};

/**
 * DOM layout extras (no VLM). Serial on one Playwright page. Focus, then
 * text-spacing, then 375/320 overflow; scroll is restored after those.
 * `complete` is false if any scanner threw — callers must not replaceDom.
 */
export async function scanLayout(page: Page, opts?: LayoutScanOpts): Promise<LayoutScan> {
  const issues: QualityIssue[] = [];
  let complete = true;
  let focusVisibleClips: FocusVisibleClip[] = [];
  const overflowShots: { where: string; screenshotPath: string }[] = [];
  const widgetClips: EvidenceClip[] = [];
  const takeOverflowShot = (width: number, tag: string): OverflowViewportShotFn | undefined => {
    if (!opts?.overflowShot) return undefined;
    return async () => {
      const path = await opts.overflowShot!(width);
      if (path) overflowShots.push({ where: tag, screenshotPath: path });
      return path;
    };
  };
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
    scanOverlap,
    scanListScanline,
    scanTabScanline,
    scanFormScanline,
    scanAdornmentClip,
    scanFontSize,
    scanDeadHash,
    scanImplicitSubmit,
    scanNoopener,
    scanScrollPadding,
    scanPointerEvents,
  ]) {
    await take(scan);
  }
  const takeEvidence = async (
    scan: (page: Page) => Promise<{ issues: QualityIssue[]; clips: EvidenceClip[] }>,
  ): Promise<void> => {
    try {
      const scanned = await scan(page);
      if (!scanned || !Array.isArray(scanned.issues)) {
        complete = false;
        return;
      }
      for (const hit of scanned.issues) {
        if (!hit.via) hit.via = "dom";
      }
      issues.push(...scanned.issues);
      if (Array.isArray(scanned.clips)) widgetClips.push(...scanned.clips);
    } catch {
      complete = false;
    }
  };
  await takeEvidence(scanTextClipEvidence);
  await takeEvidence(scanTargetSizeEvidence);
  await takeEvidence(scanTextOcclusionEvidence);
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
  await take((p) => scanOverflowMobile(p, takeOverflowShot(375, "@ 375px")));
  await take(async (p) => {
    const hits = await scanOverflowReflow(p, takeOverflowShot(320, "@ 320px"));
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
    ...(overflowShots.length > 0 ? { overflowShots } : {}),
    ...(widgetClips.length > 0 ? { widgetClips } : {}),
  };
}
