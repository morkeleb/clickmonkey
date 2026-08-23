import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ChatClient } from "../brains/chat.js";
import { nastyIgnoreSamples, textContainsNastyPayload } from "../brains/nasty.js";
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
  "sparse",
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
  "You inspect one UI screenshot. Two jobs: (1) list rendering defects you can point to in the pixels; (2) write a sitemap blurb of what the MAIN screen is for. Reply with JSON only. Always fill blurb.";

/** Sitemap caption: screen type, main-pane job, visible form/table/CTA — not chrome. */
export const VISUAL_BLURB_PROMPT = [
  "blurb (always fill; testers read this on a sitemap they have not seen):",
  "Look at the screenshot first. Caption the MAIN pane, not the sidebar or top nav.",
  "First words = screen type: dashboard, list, table, detail, form, wizard, settings, empty state, login, report, loading, or mixed.",
  "A loading frame is ONLY a spinner, skeleton, splash, or \"Loading…\" occupying the MAIN pane with no heading+content. A heading plus cards, table, form, or list is not a loading screen — even with an open dropdown or empty region. If mapped widgets lists fields or actions, it is not loading.",
  "If the shot is a loading frame: start blurb with \"loading\" and leave issues empty.",
  "Then the job of that pane (who it is for / what you do here).",
  "If you can read them: the form's purpose and submit label; what a table/list/KPI cards are of; the one most prominent primary action.",
  "One or two sentences, max 200 characters.",
  "Do not: colors, fonts, WCAG, defects, widget ids, guessed features you cannot see, repeating the URL, describing chrome as the page.",
  'Good: "Customers list with KPI cards and an empty table; primary action Add customer."',
  'Bad: "A dark web app with a purple sidebar and several buttons."',
].join("\n");

export const VISUAL_PROMPT = [
  "Look at the screenshot first. File only rendering defects you can point to in the pixels.",
  "",
  "Must-check: (1) tables/lists — a column wall shears a word, or gutters between columns collapse;",
  "(2) tab labels — a title cut mid-glyph; (3) fields — a value colliding with a trailing calendar/search icon;",
  "(4) repeating row titles, icons, or trailing actions — left or right edges do not share one line;",
  "(5) the MAIN pane — a left-locked form or column with a clear right edge and more than half the pane empty to the right.",
  "Leftover test junk in a nearby cell is not a reason to skip this checklist.",
  "",
  "Rules (file only these):",
  "- overlap: two page components occupy the same pixels (borders crossing, labels on labels). An open dropdown, select, combobox, popover, or menu covering the page behind it is expected stacking — not overlap. File the overlay only if it is itself clipped, off-screen, or colliding with another overlay. An open menu does not hide clip or scanline in the table beside it.",
  "- overflow: content leaking outside a card, modal, table, or the viewport",
  "- clip: a glyph is physically cut by something else. A table column that shears a word (\"Expert Witness Servic\") is clip. A tab title cut to \"s 1\" is clip. A value running into a trailing icon is clip. If you can read every letter of a field value, it is not clip — padding or a caret after the last letter is empty space. Naming the leftover letters means you read them; omit the issue. A % $ or unit in its own chrome beside a number (100.00 then a separate %) is not clip. A clean ellipsis (…) is not clip.",
  "- zIndex: a control is covered so a user cannot read or use it (not an open menu over the page)",
  "- align: one control in a row of the same kind is obviously stepped vs its siblings (not 1px taste, not a stacked label above its field)",
  "- scanline: a column of similar repeating row items (list titles, row icons, trailing actions) whose edges do not line up, so the eye has to hunt. Collapsed gutters between two data columns count. Not scanline: a label above its field, a table header vs its body, left-aligned names vs right-aligned amounts, items inside an open menu or overflow-tab list (longer labels next to shorter ones still share a left pad).",
  "- sparse: the MAIN pane (not the sidebar) is left-locked — a form or content column has a clear right edge, and more than half the pane to the right of that edge is empty. A column that uses ~30% of the pane is sparse. Centered cards/login (similar empty space on left and right) are not sparse. A full-width table or a second column in the right half is not sparse.",
  "- contrast: type is unreadable in this image (too faint, or too small at this screenshot size)",
  "- broken: missing image, empty icon hole, or obvious placeholder — not leftover test strings",
  "- other: a user-visible rendering defect that does not fit the list",
  "",
  "Type defects are clip (sheared glyphs) or contrast (unreadable). Not font-family or brand preference.",
  "Do not report: sticky headers/nav, expected page scroll, missing features, hover/focus you cannot see, WCAG math, inventing that a control is unclickable, masonry or staggered cards, a center-aligned hero title.",
  nastyIgnorePrompt(),
  "",
  "confidence: high = you can name the column, tab, or control; medium = likely but could be chrome; omit low.",
  "where: visible region names (e.g. \"Vendor column in the vouchers table\"). Do not invent widget ids.",
  "severity: error if it blocks reading or using a control; warning otherwise (scanline is usually warning).",
  "sight: 1-2 lines on what is on screen that should guide the next test. Not a defect list.",
  "",
  VISUAL_BLURB_PROMPT,
  "",
  'JSON only: { "issues": [ { "rule": "overlap|overflow|clip|zIndex|align|scanline|sparse|contrast|broken|other", "severity": "error"|"warning", "confidence": "high"|"medium", "where": "visible region", "message": "one line" } ], "sight": "optional 1-2 lines", "blurb": "required sitemap caption" }',
  "Empty issues only if tables, tabs, and repeating rows are actually clean. Always include blurb.",
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
  /\b(overflow|clip|overlap|z-?index|scanline|unreadable|covered|leaking|cut off|collide|misalign|shear(?:ed|s)?|ragged|gutter|truncated|too small to read)/i;

/** Product chrome the walker did not type — keep clip of these even if junk is also on screen. */
const PRODUCT_CHROME = /\b(column|tab titles?|tab labels?|void reason|column header)\b/i;

function nastyIgnorePrompt(): string {
  const samples = nastyIgnoreSamples().map((s) => `- ${JSON.stringify(s)}`);
  return [
    "Ignore leftover --nasty walker fills as content. If a field or cell shows strings like these, that is expected test data, not a rendering defect:",
    ...samples,
    "Also ignore paraphrases of that junk: XSS payload, SQL injection, malformed SVG, onload=alert, UNION SELECT.",
    "Do not file broken, clip, overflow, align, or other because that junk is visible, looks sheared, runs into an icon, or is \"inappropriate\" for a real name. We put it there.",
    "Still file clip/scanline when a product string is sheared: a vendor or client name in a table (\"Expert Witness Servic\"), a tab title, a void-reason label, a column header. Leftover junk in a nearby field is not a reason to skip that checklist.",
  ].join("\n");
}

/**
 * Oracle: the walker typed this catalog string, so quoting it is not a
 * pixel defect. Does not match paraphrases ("XSS payload"). Product
 * chrome clip on the same line still counts.
 */
export function dropPayloadContentVisual(opts: { rule: string; message: string; where?: string }): boolean {
  const blob = [opts.message, opts.where].filter(Boolean).join(" ");
  if (!textContainsNastyPayload(blob)) return false;
  if (PRODUCT_CHROME.test(blob) && LAYOUT_DEFECT.test(blob)) return false;
  return true;
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
      if (dropPayloadContentVisual(dropOpts)) continue;
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
