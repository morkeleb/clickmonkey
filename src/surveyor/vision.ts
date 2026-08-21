import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ChatClient } from "../brains/chat.js";
import { textContainsNastyPayload } from "../brains/nasty.js";
import { VisionError } from "../schema/config.js";
import type { QualityConfidence, QualityIssue } from "../schema/quality.js";

/**
 * Screenshot-only defects a user would notice. Closed list: VLMs invent
 * bugs when the taxonomy is open. Contrast here is "unreadable in the
 * pixels", not a WCAG ratio (axe already owns that).
 */
export const VISUAL_RULES = [
  "overlap",
  "overflow",
  "clip",
  "zIndex",
  "align",
  "scanline",
  "contrast",
  "broken",
  "other",
] as const;
export type VisualRule = (typeof VISUAL_RULES)[number];

export type VisualScan = {
  issues: QualityIssue[];
  sight?: string;
  hash: string;
};

export type ParsedVisualReply =
  | { ok: false }
  | { ok: true; issues: QualityIssue[]; sight?: string; blurb?: string; persist: boolean };

export type VisualScanResult =
  | { status: "skip" }
  | { status: "fail" }
  | { status: "ok"; issues: QualityIssue[]; sight?: string; blurb?: string; hash: string; persist: boolean };

export const VISION_PROBE = "ClickMonkey vision probe. Reply with the single word pong.";

const VISUAL_RULE_SET = new Set<string>(VISUAL_RULES);
const CONFIDENCE_SET = new Set<string>(["high", "medium", "low"]);

const VISUAL_SYSTEM =
  "You inspect one UI screenshot. Two jobs: (1) list rendering defects you can point to in the pixels; (2) write a sitemap blurb of what the MAIN screen is for. Reply with JSON only. Empty issues if the shot looks clean. Always fill blurb.";

/** Sitemap caption: screen type, main-pane job, visible form/table/CTA — not chrome. */
export const VISUAL_BLURB_PROMPT = [
  "blurb (always fill; testers read this on a sitemap they have not seen):",
  "Look at the screenshot first. Caption the MAIN pane, not the sidebar or top nav.",
  "First words = screen type: dashboard, list, table, detail, form, wizard, settings, empty state, login, report, or mixed.",
  "Then the job of that pane (who it is for / what you do here).",
  "If you can read them: the form's purpose and submit label; what a table/list/KPI cards are of; the one most prominent primary action.",
  "One or two sentences, max 200 characters.",
  "Do not: colors, fonts, WCAG, defects, widget ids, guessed features you cannot see, repeating the URL, describing chrome as the page.",
  'Good: "Customers list with KPI cards and an empty table; primary action Add customer."',
  'Bad: "A dark web app with a purple sidebar and several buttons."',
].join("\n");

export const VISUAL_PROMPT = [
  "Look at the screenshot first. Then list only defects you can point to in the pixels.",
  "",
  "Report these rules only:",
  "- overlap: two components or text runs occupy the same pixels (borders crossing, labels on labels)",
  "- overflow: content leaking outside a card, modal, table, or the viewport",
  "- clip: text or a control cut off mid-glyph or mid-icon, not a clean ellipsis",
  "- zIndex: a control, menu, or dialog is visibly covered so a user cannot read or use it",
  "- align: a single row or column is clearly broken (not a 1px taste difference)",
  "- scanline: a list, table, or repeating set of similar items whose icons, titles, or trailing actions do not share a vertical or horizontal edge, so the eye has to hunt instead of scanning down or across",
  "- contrast: text is unreadable on its background in this image",
  "- broken: missing image, empty icon hole, or obvious placeholder instead of content",
  "- other: a user-visible rendering defect that does not fit the list",
  "",
  "Do not report: sticky headers/nav, expected page scroll, clean ellipsis truncation, brand or typography taste, missing features, hover/focus you cannot see, WCAG math, inventing that a control is unclickable, masonry or intentionally staggered cards, or a center-aligned hero title.",
  "Do not report an open dropdown, select, combobox, popover, or menu covering the page behind it — that is expected stacking. Do report those only if the overlay itself is clipped, off-screen, or two overlays collide.",
  "Do not report that a field, cell, or URL contains XSS / SQL-injection / overlong junk (including paraphrases like \"XSS payload text\"). That is leftover --nasty test data, not a rendering defect. Do report if that text actually overflows, clips, overlaps, or breaks a shared list edge.",
  "",
  "confidence: high = two named regions clearly collide, cut, or break a shared list edge in this image; medium = likely but could be intentional chrome; low = a guess — omit low from issues.",
  "where: name the visible regions (e.g. \"filter chip on table header\"). Do not invent widget ids.",
  "severity: error if it blocks reading or using a control; warning otherwise (scanline is usually warning).",
  "sight: 1-2 lines on what is on screen that should guide the next test. Not a defect list. Do not invent widget ids.",
  "",
  VISUAL_BLURB_PROMPT,
  "",
  'JSON only: { "issues": [ { "rule": "overlap|overflow|clip|zIndex|align|scanline|contrast|broken|other", "severity": "error"|"warning", "confidence": "high"|"medium", "where": "visible region", "message": "one line" } ], "sight": "optional 1-2 lines", "blurb": "required sitemap caption" }',
  "Empty issues array if the shot looks clean. Always include blurb.",
].join("\n");

function errorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause instanceof Error ? err.cause.message : undefined;
  return cause ? `${err.message} (${cause})` : err.message;
}

export async function probeVisionChat(opts: {
  chat: ChatClient;
  baseUrl: string;
  model: string;
  apiKey?: string;
}): Promise<void> {
  let reply: string;
  try {
    reply = await opts.chat({
      baseUrl: opts.baseUrl,
      model: opts.model,
      apiKey: opts.apiKey,
      messages: [{ role: "user", content: VISION_PROBE }],
    });
  } catch (err) {
    throw new VisionError(
      `vision cannot reach the language model at ${opts.baseUrl} (model ${opts.model}): ${errorText(err)}`,
    );
  }
  if (!reply.trim()) {
    throw new VisionError(`vision reached ${opts.baseUrl} but model ${opts.model} returned an empty reply`);
  }
}

export function hashPngFile(pngPath: string): string {
  return createHash("sha1").update(readFileSync(pngPath)).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function extractJsonObject(raw: string): unknown {
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/u, "");
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    return undefined;
  }
}

const LAYOUT_DEFECT =
  /\b(overflow|clip|overlap|z-?index|scanline|unreadable|covered|leaking|cut off|collide|misalign)/i;

/** VLM often names the attack class instead of quoting the catalog string. */
const PAYLOAD_AS_CONTENT =
  /\b(xss|sql\s*injection|sqli|test payloads?|payload texts?|injection (?:text|payload|string)s?)\b/i;

/** Leftover --nasty fills are content. Layout breakage from that text still counts. */
export function dropPayloadContentVisual(opts: { rule: string; message: string; where?: string }): boolean {
  const blob = [opts.message, opts.where].filter(Boolean).join(" ");
  if (LAYOUT_DEFECT.test(blob)) return false;
  return textContainsNastyPayload(blob) || PAYLOAD_AS_CONTENT.test(blob);
}

const FLOATING_OVERLAY =
  /\b(drop-?downs?|combobox(?:es)?|popovers?|listboxes?|context menus?|select menus?)\b/i;
const OVERLAY_ITSELF_BROKEN = /\b(clip|cut off|overflow|off-?screen|leaking|viewport)\b/i;

/** Open menus covering the page behind them is stacking, not a defect. */
export function dropExpectedOverlayVisual(opts: { rule: string; message: string; where?: string }): boolean {
  if (opts.rule !== "overlap" && opts.rule !== "zIndex") return false;
  const blob = [opts.message, opts.where].filter(Boolean).join(" ");
  if (!FLOATING_OVERLAY.test(blob)) return false;
  return !OVERLAY_ITSELF_BROKEN.test(blob);
}

function visualIssue(opts: {
  rule: string;
  severity: "error" | "warning";
  message: string;
  confidence: QualityConfidence;
  where?: string;
}): QualityIssue {
  return {
    source: "visual",
    rule: opts.rule,
    severity: opts.severity,
    message: opts.message,
    count: 1,
    confidence: opts.confidence,
    ...(opts.where ? { where: opts.where } : {}),
  };
}

export function parseVisualReply(raw: string): ParsedVisualReply {
  try {
    const parsed = asRecord(extractJsonObject(raw));
    if (!parsed) return { ok: false };
    const sight = typeof parsed.sight === "string" ? parsed.sight.replace(/\s+/g, " ").trim() : "";
    const blurb = typeof parsed.blurb === "string" ? parsed.blurb.replace(/\s+/g, " ").trim() : "";
    if (!Array.isArray(parsed.issues)) {
      if (sight || blurb) {
        return {
          ok: true,
          issues: [],
          persist: false,
          ...(sight ? { sight } : {}),
          ...(blurb ? { blurb } : {}),
        };
      }
      return { ok: false };
    }
    const issues: QualityIssue[] = [];
    for (const item of parsed.issues) {
      const rec = asRecord(item);
      if (!rec) continue;
      const message = typeof rec.message === "string" ? rec.message.replace(/\s+/g, " ").trim() : "";
      if (!message) continue;
      const confidenceRaw = typeof rec.confidence === "string" ? rec.confidence.toLowerCase() : "medium";
      const confidence = CONFIDENCE_SET.has(confidenceRaw)
        ? (confidenceRaw as QualityConfidence)
        : "medium";
      if (confidence === "low") continue;
      const rule = typeof rec.rule === "string" && VISUAL_RULE_SET.has(rec.rule) ? rec.rule : "other";
      const severity = rec.severity === "error" ? "error" : "warning";
      const where = typeof rec.where === "string" ? rec.where.replace(/\s+/g, " ").trim() : "";
      const dropOpts = { rule, message, ...(where ? { where } : {}) };
      if (dropPayloadContentVisual(dropOpts) || dropExpectedOverlayVisual(dropOpts)) continue;
      issues.push(
        visualIssue({
          rule,
          severity,
          message,
          confidence,
          ...(where ? { where } : {}),
        }),
      );
    }
    return {
      ok: true,
      issues,
      persist: true,
      ...(sight ? { sight } : {}),
      ...(blurb ? { blurb } : {}),
    };
  } catch {
    return { ok: false };
  }
}

export async function examineScreenshot(opts: {
  chat: ChatClient;
  baseUrl: string;
  model: string;
  apiKey?: string;
  pngPath: string;
  /** Matching PNG hash → `{ status: "skip" }` (no LLM). */
  lastHash?: string;
  /** Optional JPEG on the wire; production sends the PNG file. */
  jpeg?: Buffer;
  /** Mapped widgets for the blurb; do not invent ids from this. */
  facts?: string;
}): Promise<VisualScanResult> {
  const hash = hashPngFile(opts.pngPath);
  if (opts.lastHash === hash) return { status: "skip" };
  const bytes = opts.jpeg ?? readFileSync(opts.pngPath);
  const mime = opts.jpeg ? "image/jpeg" : "image/png";
  const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;
  let raw: string;
  try {
    raw = await opts.chat({
      baseUrl: opts.baseUrl,
      model: opts.model,
      apiKey: opts.apiKey,
      messages: [
        { role: "system", content: VISUAL_SYSTEM },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl } },
            {
              type: "text",
              text: opts.facts
                ? `${VISUAL_PROMPT}\n\nMapped widgets (do not invent ids):\n${opts.facts}`
                : VISUAL_PROMPT,
            },
          ],
        },
      ],
    });
  } catch {
    return { status: "fail" };
  }
  const parsed = parseVisualReply(raw);
  if (!parsed.ok) return { status: "fail" };
  return {
    status: "ok",
    issues: parsed.issues,
    persist: parsed.persist,
    ...(parsed.sight ? { sight: parsed.sight } : {}),
    ...(parsed.blurb ? { blurb: parsed.blurb } : {}),
    hash,
  };
}
