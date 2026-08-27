export const PAGE_NODE = { width: 188, height: 72 } as const;
export const NESTED_PAGE = { width: 200, height: 58 } as const;
export const SECTION_NODE = { width: 236, height: 64 } as const;
export const DIALOG_NODE = { width: 160, height: 48 } as const;

/** Horizontal gap between rank bounding boxes (LR). */
export const RANK_SEP = 72;
export const NODE_SEP = 40;
/** Nested pages in an expanded section wrap to this many columns when the cluster is large. */
export const NEST_COL_COUNT = 2;
export const NEST_COL_MIN = 8;
export const NEST_COL_GAP = 8;

export function nestColumns(pageCount: number): number {
  return pageCount >= NEST_COL_MIN ? NEST_COL_COUNT : 1;
}
/** Space between a page card's right edge and its dialog stack. */
export const DIALOG_GAP_X = 40;
export const DIALOG_GAP_Y = 8;

export function dialogRailWidth(count: number): number {
  return count > 0 ? DIALOG_GAP_X + DIALOG_NODE.width : 0;
}

export function dialogStackHeight(count: number): number {
  if (count <= 0) return 0;
  return count * DIALOG_NODE.height + (count - 1) * DIALOG_GAP_Y;
}

export function pageBoxSize(
  card: { width: number; height: number },
  dialogCount: number,
): { width: number; height: number } {
  return {
    width: card.width + dialogRailWidth(dialogCount),
    height: Math.max(card.height, dialogStackHeight(dialogCount)),
  };
}

export type LayoutBox = { id: string; x: number; y: number; width: number; height: number };

export function boxesOverlap(a: LayoutBox, b: LayoutBox, gap = 0): boolean {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}
