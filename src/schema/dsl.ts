import type { Log, Step } from "./log.js";

export class DslParseError extends Error {
  constructor(
    readonly lineNo: number,
    message: string,
  ) {
    super(`line ${lineNo}: ${message}`);
    this.name = "DslParseError";
  }
}

function splitRef(ref: string, lineNo: number): { surface: string; id: string } {
  const i = ref.lastIndexOf(".");
  if (i <= 0 || i === ref.length - 1) {
    throw new DslParseError(lineNo, `expected surface.id, got ${JSON.stringify(ref)}`);
  }
  return { surface: ref.slice(0, i), id: ref.slice(i + 1) };
}

/** Parse a fill value: "", quoted string, or bare token (including $VAR). */
export function parseFillValue(raw: string, lineNo: number): string {
  if (raw === '""' || raw === "''") return "";
  if (
    (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) ||
    (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2)
  ) {
    return raw.slice(1, -1);
  }
  if (raw.includes(" ") && !raw.startsWith("$")) {
    throw new DslParseError(lineNo, `ambiguous fill value ${JSON.stringify(raw)}; quote it`);
  }
  return raw;
}

export function parseLine(line: string, lineNo = 1): Step | { comment: string } | null {
  const trimmed = line.trim();
  if (trimmed === "") return null;
  if (trimmed.startsWith("#")) return { comment: trimmed.slice(1).trim() };

  const open = trimmed.match(/^open\s+(\S+)$/);
  if (open?.[1]) return { kind: "open", page: open[1] };

  const click = trimmed.match(/^click\s+(\S+)$/);
  if (click?.[1]) {
    const { surface, id } = splitRef(click[1], lineNo);
    return { kind: "click", surface, id };
  }

  const fill = trimmed.match(/^fill\s+(\S+)\s+(.+)$/);
  if (fill?.[1] && fill[2] !== undefined) {
    const { surface, id } = splitRef(fill[1], lineNo);
    return { kind: "fill", surface, id, value: parseFillValue(fill[2], lineNo) };
  }

  const expectInvalid = trimmed.match(/^expect\s+(\S+)\s+invalid$/);
  if (expectInvalid?.[1]) {
    const { surface, id } = splitRef(expectInvalid[1], lineNo);
    return { kind: "expectInvalid", surface, id };
  }

  const expectVisible = trimmed.match(/^expect\s+(\S+)\s+visible$/);
  if (expectVisible?.[1]) {
    return { kind: "expectVisible", surface: expectVisible[1] };
  }

  const expectPath = trimmed.match(/^expect\s+path\s+(\S+)$/);
  if (expectPath?.[1]) return { kind: "expectPath", path: expectPath[1] };

  throw new DslParseError(lineNo, `unknown step ${JSON.stringify(trimmed)}`);
}

export function formatStep(step: Step): string {
  switch (step.kind) {
    case "open":
      return `open ${step.page}`;
    case "click":
      return `click ${step.surface}.${step.id}`;
    case "fill": {
      const v = step.value === "" ? '""' : /\s/.test(step.value) ? JSON.stringify(step.value) : step.value;
      return `fill ${step.surface}.${step.id} ${v}`;
    }
    case "expectInvalid":
      return `expect ${step.surface}.${step.id} invalid`;
    case "expectVisible":
      return `expect ${step.surface} visible`;
    case "expectPath":
      return `expect path ${step.path}`;
  }
}

export function parseLog(text: string): Log {
  const comments: string[] = [];
  let bug: string | undefined;
  let found: string | undefined;
  const steps: Step[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseLine(lines[i] ?? "", i + 1);
    if (!parsed) continue;
    if ("comment" in parsed) {
      const c = parsed.comment;
      const bugMatch = c.match(/^bug:\s*(.+)$/i);
      const foundMatch = c.match(/^found:\s*(.+)$/i);
      if (bugMatch?.[1]) bug = bugMatch[1].trim();
      else if (foundMatch?.[1]) found = foundMatch[1].trim();
      else if (c) comments.push(c);
      continue;
    }
    steps.push(parsed);
  }
  return {
    schemaVersion: 1,
    bug,
    found,
    comments,
    steps,
    usedLocators: {},
  };
}

export function formatLog(log: Log): string {
  const out: string[] = [];
  if (log.bug) out.push(`# bug: ${log.bug}`);
  if (log.found) out.push(`# found: ${log.found}`);
  for (const c of log.comments) out.push(`# ${c}`);
  if (out.length && log.steps.length) out.push("");
  for (const step of log.steps) out.push(formatStep(step));
  if (out.length === 0 || out[out.length - 1] !== "") out.push("");
  return out.join("\n");
}
