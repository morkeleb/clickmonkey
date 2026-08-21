import { z } from "zod";

export const FindingKind = z.enum([
  "expectFailed",
  "httpError",
  "notFound",
  "pageError",
  "fenceViolation",
  "unresolvedId",
  "unknownId",
  "driftId",
  "writePolicyBlocked",
  "locatorAmbiguous",
  "uiIssue",
  "visualIssue",
]);
export type FindingKind = z.infer<typeof FindingKind>;

export const FindingSeverity = z.enum(["critical", "major", "minor", "suggestion"]);
export type FindingSeverity = z.infer<typeof FindingSeverity>;

export function severityForKind(kind: FindingKind): FindingSeverity {
  switch (kind) {
    case "pageError":
    case "httpError":
    case "notFound":
      return "critical";
    case "expectFailed":
    case "fenceViolation":
    case "writePolicyBlocked":
      return "major";
    case "unresolvedId":
    case "unknownId":
    case "driftId":
    case "locatorAmbiguous":
      return "minor";
    case "uiIssue":
      return "suggestion";
    case "visualIssue":
      return "minor";
  }
}

export const Finding = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    kind: FindingKind,
    severity: FindingSeverity.optional(),
    message: z.string().min(1),
    tapePath: z.string().min(1),
    screenshotPath: z.string().min(1).optional(),
    stepIndex: z.number().int().nonnegative(),
    httpStatus: z.number().int().optional(),
    url: z.string().min(1).optional(),
    widgetRef: z.string().min(1).optional(),
  })
  .strict();
export type Finding = z.infer<typeof Finding>;

export type PageErrorFillCtx = {
  field?: string;
  value?: string;
  markedInvalid?: boolean;
};

/** Strip a wrapper we may have already applied at persist time. */
function pageErrorDetail(message: string): string {
  const exc = message.match(/Exception: `([^`]+)`/);
  if (exc?.[1]) return exc[1].replace(/\s+/g, " ").trim();
  const titled = message.match(/Uncaught JavaScript (?:error|exception):\s*(.+)/i);
  if (titled?.[1]) {
    return titled[1]
      .replace(/\s*\(page threw; this is not field validation\)\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  const first = message.split("\n")[0]!.replace(/\s+/g, " ").trim();
  return first
    .replace(/^This is an uncaught JavaScript error\b.*$/i, "")
    .replace(/^This is a `pageerror`\b.*$/i, "")
    .replace(/\s*\(page threw; this is not field validation\)\s*$/i, "")
    .replace(/\s*The page threw instead of showing a field error\.?\s*$/i, "")
    .trim();
}

export function pageErrorTitle(message: string): string {
  return `Uncaught JavaScript error: ${pageErrorDetail(message)}`;
}

function fillFromStoredExplanation(message: string): PageErrorFillCtx | undefined {
  const m = message.match(/ClickMonkey had just filled `([^`]+)`(?: with ("(?:\\.|[^"\\])*"))?/);
  if (!m?.[1]) return undefined;
  let value: string | undefined;
  if (m[2]) {
    try {
      value = JSON.parse(m[2]) as string;
    } catch {
      value = m[2].slice(1, -1);
    }
  }
  return {
    field: m[1],
    ...(value !== undefined ? { value } : {}),
    ...(/was not marked invalid/.test(message) ? { markedInvalid: false } : {}),
  };
}

export function pageErrorExplanation(message: string, fill?: PageErrorFillCtx): string {
  const detail = pageErrorDetail(message);
  const ctx = fill?.field ? fill : fillFromStoredExplanation(message);
  const lines = [
    "This is an uncaught JavaScript error (Playwright `pageerror`): the page crashed. It is not `console.error` and not a field validation message.",
    "",
  ];
  if (ctx?.field) {
    const shown = ctx.value !== undefined ? ` with ${JSON.stringify(ctx.value)}` : "";
    lines.push(`ClickMonkey had just filled \`${ctx.field}\`${shown}.`);
    if (ctx.markedInvalid === false) {
      lines.push("The field was not marked invalid (`aria-invalid`, visible error, or HTML5 constraint validation).");
    }
    lines.push(
      "The page threw an uncaught JS error instead of rejecting the input. That means validation is missing or does not wrap parsing. A junk value that crashes the page is a product bug, not an expected reaction to bad input.",
    );
  } else {
    lines.push(`Uncaught JS error: \`${detail}\`. The exception escaped page JavaScript.`);
  }
  lines.push("", `Exception: \`${detail}\`.`);
  return lines.join("\n");
}

export type ValidationMissFill = { field: string; value: string };

const INVALID_MARKS = "`aria-invalid`, a visible `{id}-error`, or HTML5 constraint validation (form not `novalidate`)";

export function validationMissExplanation(fills: ValidationMissFill[]): string {
  if (fills.length === 0) {
    return [
      "Validation did not catch this input",
      "",
      `After submit the field was still not marked invalid (${INVALID_MARKS}). The form accepted input that should have been rejected.`,
    ].join("\n");
  }
  const empty = fills.every((f) => f.value.trim() === "");
  const first = fills[0]!;
  const title = empty
    ? fills.length === 1
      ? `Required field \`${first.field}\` accepted empty`
      : "Required fields accepted empty"
    : fills.length === 1
      ? `Validation did not catch junk in \`${first.field}\``
      : `Validation did not catch junk in ${fills.length} fields`;
  const lines = [
    title,
    "",
    empty
      ? "The form accepted a blank required field. This is a product bug: validation did not mark the field invalid."
      : "The form accepted input that should have been rejected. This is a product bug: validation is missing or does not run on submit.",
    "",
  ];
  for (const f of fills) {
    lines.push(`- filled \`${f.field}\` with ${JSON.stringify(f.value)}`);
  }
  lines.push(
    "",
    `After submit those fields were still not marked invalid (${INVALID_MARKS}).`,
  );
  return lines.join("\n");
}

export function findingReportTitle(kind: FindingKind, message: string): string {
  if (kind === "pageError") return pageErrorTitle(message);
  return message.split("\n").map((l) => l.trim()).find(Boolean) ?? message;
}

export function findingTapeBug(kind: FindingKind, message: string): string {
  return findingReportTitle(kind, message).replace(/\s+/g, " ").slice(0, 240);
}

export function findingId(stepIndex: number, kind: FindingKind, n?: number): string {
  return n === undefined
    ? `fnd_${stepIndex}_${kind}`
    : `fnd_${stepIndex}_${kind}_${n}`;
}
