import type { Page } from "playwright";
import { mergeQualityIssues, type QualityIssue } from "../schema/quality.js";
import { scanBroken } from "./broken.js";
import { scanListScanline } from "./list-scanline.js";
import { scanOverlap } from "./overlap.js";
import { scanOverflow } from "./overflow.js";
import { scanTableLayout } from "./scanline.js";
import { scanTargetSize } from "./target-size.js";
import { scanTextClip } from "./text-clip.js";

/**
 * DOM layout extras (no VLM). Table clip/scanline/sparse plus overflow,
 * broken images, text clip, overlap/zIndex, list scanline, target size.
 * One failed scanner must not drop the rest.
 */
export async function scanLayout(page: Page): Promise<QualityIssue[]> {
  const settled = await Promise.allSettled([
    scanTableLayout(page),
    scanOverflow(page),
    scanBroken(page),
    scanTextClip(page),
    scanOverlap(page),
    scanListScanline(page),
    scanTargetSize(page),
  ]);
  const issues: QualityIssue[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled" && Array.isArray(result.value)) {
      issues.push(...result.value);
    }
  }
  return mergeQualityIssues(issues);
}
