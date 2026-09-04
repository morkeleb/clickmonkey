export type DateMaskOrder = "mdy" | "dmy" | "ymd";

export type DateMask = {
  order: DateMaskOrder;
  sep: string;
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MASKS: readonly { re: RegExp; order: DateMaskOrder }[] = [
  { re: /^(m{1,2})([/\-.])(d{1,2})\2(y{2,4})$/i, order: "mdy" },
  { re: /^(d{1,2})([/\-.])(m{1,2})\2(y{2,4})$/i, order: "dmy" },
  { re: /^(y{2,4})([/\-.])(m{1,2})\2(d{1,2})$/i, order: "ymd" },
];

/** Whole ids that end in `date` but are not date fields (`update`, `candidate`). */
const NOT_DATE_IDS = new Set(["update", "candidate", "validate", "mandate", "predate", "antedate"]);

/**
 * Name looks like a date even on `type=text`: `due_from`, `invoicedate`, `posted_date`.
 * Not English words that merely end in those letters (`update`).
 */
export function looksLikeDateFieldName(id: string, label?: string): boolean {
  const tokens = new Set<string>();
  for (const raw of [id, label ?? ""]) {
    if (!raw) continue;
    const camel = raw.replace(/([a-z])([A-Z])/g, "$1 $2");
    for (const t of camel.toLowerCase().split(/[^a-z0-9]+/)) {
      if (t.length >= 2) tokens.add(t);
    }
    const compact = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (compact.endsWith("datetime") && compact.length > "datetime".length) {
      tokens.add("datetime");
    } else if (
      compact.endsWith("date") &&
      !compact.endsWith("time") &&
      compact.length - 4 >= 3 &&
      !NOT_DATE_IDS.has(compact)
    ) {
      tokens.add("date");
    }
  }
  if (tokens.has("date") || tokens.has("datetime")) return true;
  // `due_from` / bare `due`, not `amount_due` or `due_diligence`.
  return tokens.has("due") && (tokens.has("from") || tokens.has("to") || tokens.has("on") || tokens.size === 1);
}

/** Letter-token date placeholders (`MM/DD/YYYY`, `dd.mm.yyyy`, `yyyy-mm-dd`). Not "Enter a date". */
export function parseDateMask(placeholder: string | undefined): DateMask | undefined {
  const raw = (placeholder ?? "").replace(/\s+/g, "");
  if (!raw) return undefined;
  for (const m of MASKS) {
    const hit = m.re.exec(raw);
    if (hit?.[2]) return { order: m.order, sep: hit[2] };
  }
  return undefined;
}

export function looksLikeDateMask(placeholder: string | undefined): boolean {
  return parseDateMask(placeholder) !== undefined;
}

/** ISO or digit/sep/digit/sep/digit (`01/31/2026`). Not SQL/XSS junk. */
export function looksLikeDateInput(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (ISO_DATE.test(v)) return true;
  return /^\d{1,4}[/\-.]\d{1,2}[/\-.]\d{1,4}$/.test(v);
}

function isDateControl(opts: { placeholder?: string; htmlType?: string; fieldType?: string }): boolean {
  const html = (opts.htmlType ?? "").toLowerCase();
  const field = (opts.fieldType ?? "").toLowerCase();
  return html === "date" || field === "date" || looksLikeDateMask(opts.placeholder);
}

/** Masked/native date that refused a non-date string. The control worked; not a fill miss. */
export function dateControlRejectedNonDate(
  typed: string,
  opts: { placeholder?: string; htmlType?: string; fieldType?: string },
): boolean {
  if (!isDateControl(opts)) return false;
  const v = typed.trim();
  return v.length > 0 && !looksLikeDateInput(v);
}

export function formatIsoDate(iso: string, mask: DateMask): string | undefined {
  const m = ISO_DATE.exec(iso);
  if (!m) return undefined;
  const y = m[1]!;
  const month = m[2]!;
  const d = m[3]!;
  if (mask.order === "mdy") return `${month}${mask.sep}${d}${mask.sep}${y}`;
  if (mask.order === "dmy") return `${d}${mask.sep}${month}${mask.sep}${y}`;
  return `${y}${mask.sep}${month}${mask.sep}${d}`;
}

/** Native `type=date` stays ISO. Letter-token placeholders rewrite `YYYY-MM-DD`. */
export function dateFillValue(
  value: string,
  opts: { placeholder?: string; htmlType?: string; fieldType?: string },
): string {
  if (!ISO_DATE.test(value)) return value;
  const htmlType = (opts.htmlType ?? "").toLowerCase();
  const fieldType = (opts.fieldType ?? "").toLowerCase();
  if (htmlType === "date" || fieldType === "date") return value;
  const mask = parseDateMask(opts.placeholder);
  if (!mask) return value;
  return formatIsoDate(value, mask) ?? value;
}
