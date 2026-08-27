/**
 * Screenshot-only defects a user would notice. Closed list: VLMs invent
 * bugs when the taxonomy is open. Contrast here is "unreadable in the
 * pixels", not a WCAG ratio (axe already owns that). DOM scanners own
 * geometry; the VLM must not re-file those rules.
 */
export const VISUAL_RULES = [
  "overlap",
  "overflow",
  "clip",
  "zIndex",
  "align",
  "scanline",
  "sparse",
  "targetSize",
  "contrast",
  "broken",
  "focusObscured",
  "focusVisible",
  "textOcclusion",
  "fontSize",
  "textSpacing",
  "deadHash",
  "implicitSubmit",
  "noopener",
  "scrollPadding",
  "pointerEvents",
  "other",
] as const;
export type VisualRule = (typeof VISUAL_RULES)[number];
