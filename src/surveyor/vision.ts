import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ChatClient } from "../brains/chat.js";
import { nastyIgnoreSamples, textContainsNastyPayload } from "../brains/nasty.js";
import { VisionError } from "../schema/config.js";
import { FOG_FRESH_MS } from "../schema/fog.js";
import type { QualityConfidence, QualityIssue } from "../schema/quality.js";

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

/** Geometry + hit targets the DOM already measured. parseVisualReply drops these. */
export const DOM_OWNED_VISUAL_RULES = [
  "overflow",
  "clip",
  "scanline",
  "sparse",
  "overlap",
  "zIndex",
  "broken",
  "targetSize",
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
] as const;

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

const VISUAL_RULE_BY_LOWER = new Map<string, string>(VISUAL_RULES.map((r) => [r.toLowerCase(), r]));
const DOM_OWNED_VISUAL_RULE_SET = new Set<string>(DOM_OWNED_VISUAL_RULES);
const CONFIDENCE_SET = new Set<string>(["high", "medium", "low"]);

const VISUAL_SYSTEM =
  "You inspect one UI screenshot. Two jobs: (1) list pixel defects the DOM did not already measure; (2) write a sitemap blurb of what the MAIN screen is for. Reply with JSON only. Always fill blurb.";

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
  "DOM already measured overflow, clip, scanline, sparse, overlap, covered controls, broken images, hit targets, focus-obscured, missing focus rings, text occlusion, tiny type, text-spacing clip, dead in-page hashes, implicit submit buttons, target=_blank without noopener, sticky scroll-padding, and pointer-events:none. Do not re-file those rules.",
  "",
  "File only:",
  "- empty-vs-broken: an empty table or list vs a visible error / failed-load state (not a quiet empty table)",
  "- visible error/toast chrome the walker might miss",
  "- mapped widgets listed below that are missing from the pixels",
  "- a field value colliding with a trailing calendar/search icon",
  "- canvas or icon-font holes (empty glyph boxes, missing icon ink)",
  "- abnormal ellipsis: `…` / clipped title when the box still has unused room (not a full column of ellipsis on a narrow table)",
  "- mojibake / tofu: replacement glyphs, \uFFFD, empty icon-font squares beyond a single canvas hole",
  "- chart/canvas labels cut or missing (no DOM text)",
  "- leftover lorem / \"TODO\" / \"lorem ipsum\" / debug copy in the main pane",
  "- missing fade/mask on a scrolling list (items cut with a hard edge, no gradient)",
  "- contrast: type is unreadable in this screenshot (too faint on its background)",
  "- align: one control in a row of the same kind is obviously stepped vs its siblings (not 1px, not a stacked label above its field)",
  "",
  "Rules (file only these):",
  "- contrast: type is unreadable in this image (too faint on its background)",
  "- align: one control in a row of the same kind is obviously stepped vs its siblings (not 1px taste, not a stacked label above its field)",
  "- other: a user-visible rendering defect that does not fit the list (empty-vs-broken, toast chrome, missing mapped widget, icon collision, canvas hole, abnormal ellipsis, mojibake/tofu, chart labels, leftover lorem/TODO, missing scroll fade)",
  "",
  "Type defects are contrast (unreadable in this image). Not font-family, brand preference, or body copy size (DOM already measured font-size).",
  "Do not report: sticky headers/nav, expected page scroll, missing features, hover/focus you cannot see, WCAG math, inventing that a control is unclickable, masonry or staggered cards, a center-aligned hero title.",
  nastyIgnorePrompt(),
  "",
  "confidence: high = you can name the column, tab, or control; medium = likely but could be chrome; omit low.",
  "where: visible region names (e.g. \"toast in the top-right\"). Do not invent widget ids.",
  "severity: error if it blocks reading or using a control; warning otherwise.",
  "sight: 1-2 lines on what is on screen that should guide the next test. Not a defect list.",
  "",
  VISUAL_BLURB_PROMPT,
  "",
  'JSON only: { "issues": [ { "rule": "contrast|align|other", "severity": "error"|"warning", "confidence": "high"|"medium", "where": "visible region", "message": "one line" } ], "sight": "optional 1-2 lines", "blurb": "required sitemap caption" }',
  "Empty issues if none of the above are visible. Always include blurb.",
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

/** Geometry words next to these hunts are still pixel-only (toast, chart labels, icon collision). */
const PIXEL_OTHER_KEEP =
  /\b(?:toast|snackbar|ellipsis|mojibake|tofu|replacement.?glyph|lorem|todo|(?:chart|canvas)(?:\s+axis)?\s+labels?|failed.?load|icons?\s+collision|missing fade|scroll(?:ing)?\s+(?:fade|mask))\b|(?:icons?.{0,40}collid|collid.{0,40}icons?)/i;
/** Geometry restated as `other`, and product-chrome clip of junk (dropPayloadContentVisual). */
const LAYOUT_DEFECT =
  /\b(?:overflow(?:ing|s)?|clip(?:ped|s)?|overlap(?:ping|s)?|z-?index|scanline|unreadable|cover(?:ed|ing)|leaking|cut off|collid(?:e|es|ed|ing)|misalign|shear(?:ed|s)?|ragged|gutter|truncated|too small to read)\b/i;

/** Product chrome the walker did not type — keep clip of these even if junk is also on screen. */
const PRODUCT_CHROME = /\b(column|tab titles?|tab labels?|void reason|column header)\b/i;

function nastyIgnorePrompt(): string {
  const samples = nastyIgnoreSamples().map((s) => `- ${JSON.stringify(s)}`);
  return [
    "Ignore leftover --nasty walker fills as content. If a field or cell shows strings like these, that is expected test data, not a rendering defect:",
    ...samples,
    "Also ignore paraphrases of that junk: XSS payload, SQL injection, malformed SVG, onload=alert, UNION SELECT.",
    "Do not file contrast, align, other, or a missing-content hole because that junk is visible, looks sheared, or is \"inappropriate\" for a real name. We put it there.",
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
    via: "vlm",
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
      const ruleRaw = typeof rec.rule === "string" ? rec.rule.trim() : "";
      const rule = VISUAL_RULE_BY_LOWER.get(ruleRaw.toLowerCase()) ?? "other";
      if (DOM_OWNED_VISUAL_RULE_SET.has(rule)) continue;
      if (rule === "other" && LAYOUT_DEFECT.test(message) && !PIXEL_OTHER_KEEP.test(message)) continue;
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

export type MeasuredVisualHit = { rule: string; message: string; where?: string };

function visionUserText(opts: { facts?: string; measured?: MeasuredVisualHit[] }): string {
  let text = VISUAL_PROMPT;
  if (opts.facts) text += `\n\nMapped widgets (do not invent ids):\n${opts.facts}`;
  if (opts.measured && opts.measured.length > 0) {
    const lines = opts.measured.map((m) => `- ${m.rule}: ${m.where ?? m.message}`);
    text += `\n\nAlready measured (do not repeat):\n${lines.join("\n")}`;
  }
  return text;
}

/** Fog-fresh extras skip. Callers still force a pass when `needBlurb`. */
export function shouldSkipVision(opts: { staleMs: number; unchanged: boolean }): boolean {
  return opts.unchanged && opts.staleMs <= FOG_FRESH_MS;
}

/** Whether to call the VLM. Caption and first-run Sight still force a pass. */
export function visionPass(opts: {
  needBlurb: boolean;
  needSight: boolean;
  pngUnchanged: boolean;
  staleMs: number;
  triedThisRun: boolean;
}): "skip" | "call" {
  if (opts.needBlurb || opts.needSight) return "call";
  if (shouldSkipVision({ staleMs: opts.staleMs, unchanged: opts.pngUnchanged })) return "skip";
  if (opts.triedThisRun) return "skip";
  return "call";
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
  /** DOM layout hits already on the ledger. Grounding; do not re-file. */
  measured?: MeasuredVisualHit[];
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
              text: visionUserText(opts),
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
