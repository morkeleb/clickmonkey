import type { QualityIssue } from "../schema/quality.js";

/** Main pane narrower than this is a single column by design. */
export const SPARSE_MIN_PANE = 900;
/** Content column uses at most this share of the main pane. */
export const SPARSE_USED_MAX = 0.5;
/** Flush-left: content starts within this share of the pane. */
export const SPARSE_LEFT_LOCK = 0.2;
/** Similar left and right gaps → centered card, not a leftover column. */
export const SPARSE_CENTER_GAP = 0.18;
/** Used width at or below this looks off even when it still clears 50% empty. */
export const SPARSE_HIGH_USED = 0.35;

export type SparseBox = {
  left: number;
  right: number;
  top?: number;
  bottom?: number;
};

export type SparsePane = {
  left: number;
  right: number;
};

export type SparseSample = {
  pane: SparsePane;
  boxes: SparseBox[];
  where?: string;
};

export type SparseMetrics = {
  paneWidth: number;
  used: number;
  leftGap: number;
  rightGap: number;
  leftLocked: boolean;
  centered: boolean;
  emptyRight: boolean;
  rightColumn: boolean;
};

/**
 * Union of content boxes inside the main pane. Ignores tiny slivers.
 * Right-column: two or more boxes that start in the right half.
 */
export function sparseMetrics(sample: SparseSample): SparseMetrics | undefined {
  const paneW = sample.pane.right - sample.pane.left;
  if (!(paneW >= SPARSE_MIN_PANE)) return undefined;
  let minL = Infinity;
  let maxR = -Infinity;
  let n = 0;
  const mid = sample.pane.left + paneW * 0.5;
  let rightColumn = 0;
  for (const b of sample.boxes) {
    const left = Math.max(b.left, sample.pane.left);
    const right = Math.min(b.right, sample.pane.right);
    if (right - left < 8) continue;
    minL = Math.min(minL, left);
    maxR = Math.max(maxR, right);
    n += 1;
    if (b.left >= mid - 8) rightColumn += 1;
  }
  if (n === 0 || !Number.isFinite(minL) || maxR <= minL) return undefined;
  const used = (maxR - minL) / paneW;
  const leftGap = (minL - sample.pane.left) / paneW;
  const rightGap = (sample.pane.right - maxR) / paneW;
  const leftLocked = leftGap <= SPARSE_LEFT_LOCK;
  const centered =
    leftGap >= SPARSE_CENTER_GAP &&
    rightGap >= SPARSE_CENTER_GAP &&
    Math.abs(leftGap - rightGap) <= SPARSE_CENTER_GAP;
  return {
    paneWidth: paneW,
    used,
    leftGap,
    rightGap,
    leftLocked,
    centered,
    emptyRight: rightGap >= 1 - SPARSE_USED_MAX,
    rightColumn: rightColumn >= 2,
  };
}

export function sparseLayoutIssue(sample: SparseSample | null | undefined): QualityIssue | undefined {
  if (!sample || !Array.isArray(sample.boxes) || !sample.pane) return undefined;
  const m = sparseMetrics(sample);
  if (!m) return undefined;
  if (m.centered || m.rightColumn || !m.leftLocked) return undefined;
  if (m.used > SPARSE_USED_MAX) return undefined;
  const pct = Math.round(m.used * 100);
  const emptyPct = Math.round(m.rightGap * 100);
  const where = sample.where?.trim() || "main pane";
  return {
    source: "visual",
    rule: "sparse",
    severity: "warning",
    confidence: m.used <= SPARSE_HIGH_USED ? "high" : "medium",
    count: 1,
    where,
    message: `Content is left-aligned and uses ${pct}% of the pane; ${emptyPct}% of the width is empty on the right`,
  };
}
