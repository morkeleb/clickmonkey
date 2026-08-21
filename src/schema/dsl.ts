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

export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

/** First useful line of a finding message — Playwright Call logs must not become DSL. */
export function oneLineBug(text: string): string {
  const clean = stripAnsi(text).replace(/\r\n/g, "\n");
  const first =
    clean
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !/^call log:?$/i.test(l)) ?? clean.trim();
  const intercept = /intercepts pointer events/i.test(clean);
  if (intercept && !/intercepts pointer events/i.test(first)) {
    return `${first} (pointer events intercepted)`;
  }
  return first;
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
  if (raw.startsWith('"')) {
    try {
      const v = JSON.parse(raw) as unknown;
      if (typeof v === "string") return v;
    } catch {
      throw new DslParseError(lineNo, `invalid quoted value ${JSON.stringify(raw)}`);
    }
    throw new DslParseError(lineNo, `invalid quoted value ${JSON.stringify(raw)}`);
  }
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    return raw.slice(1, -1);
  }
  if (raw.includes(" ") && !raw.startsWith("$")) {
    throw new DslParseError(lineNo, `ambiguous fill value ${JSON.stringify(raw)}; quote it`);
  }
  return raw;
}

function formatFillValue(value: string): string {
  return value === "" || /\s/.test(value) ? JSON.stringify(value) : value;
}

export function parseLine(line: string, lineNo = 1): Step | { comment: string } | null {
  const trimmed = line.trim();
  if (trimmed === "") return null;
  if (trimmed.startsWith("#")) return { comment: trimmed.slice(1).trim() };

  const open = trimmed.match(/^open\s+(\S+)$/);
  if (open?.[1]) return { kind: "open", page: open[1] };

  const click = trimmed.match(/^click\s+(\S+)(?:\s+(nav))?$/);
  if (click?.[1]) {
    const { surface, id } = splitRef(click[1], lineNo);
    return { kind: "click", surface, id, ...(click[2] ? { nav: true } : {}) };
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

  const expectPageText = trimmed.match(/^expect\s+text\s+(.+)$/);
  if (expectPageText?.[1] !== undefined) {
    return { kind: "expectPageText", text: parseFillValue(expectPageText[1], lineNo) };
  }

  const expectText = trimmed.match(/^expect\s+(\S+)\s+text\s+(.+)$/);
  if (expectText?.[1] && expectText[2] !== undefined) {
    const { surface, id } = splitRef(expectText[1], lineNo);
    return { kind: "expectText", surface, id, text: parseFillValue(expectText[2], lineNo) };
  }

  const expectValue = trimmed.match(/^expect\s+(\S+)\s+value\s+(.+)$/);
  if (expectValue?.[1] && expectValue[2] !== undefined) {
    const { surface, id } = splitRef(expectValue[1], lineNo);
    return { kind: "expectValue", surface, id, value: parseFillValue(expectValue[2], lineNo) };
  }

  const expectHidden = trimmed.match(/^expect\s+(\S+)\s+hidden$/);
  if (expectHidden?.[1]) {
    return { kind: "expectHidden", surface: expectHidden[1] };
  }

  if (trimmed === "screenshot") return { kind: "screenshot" };
  const shotUi = trimmed.match(/^screenshot\s+ui(?:\s+(.+))?$/);
  if (shotUi) {
    const raw = shotUi[1]?.trim();
    return {
      kind: "screenshot",
      ui: true,
      ...(raw ? { label: parseFillValue(raw, lineNo) } : {}),
    };
  }
  const shot = trimmed.match(/^screenshot\s+(.+)$/);
  if (shot?.[1]) {
    return { kind: "screenshot", label: parseFillValue(shot[1], lineNo) };
  }

  throw new DslParseError(lineNo, `unknown step ${JSON.stringify(trimmed)}`);
}

export function formatStep(step: Step): string {
  switch (step.kind) {
    case "open":
      return `open ${step.page}`;
    case "click":
      return step.nav ? `click ${step.surface}.${step.id} nav` : `click ${step.surface}.${step.id}`;
    case "fill": {
      const v = formatFillValue(step.value);
      return `fill ${step.surface}.${step.id} ${v}`;
    }
    case "expectInvalid":
      return `expect ${step.surface}.${step.id} invalid`;
    case "expectVisible":
      return `expect ${step.surface} visible`;
    case "expectHidden":
      return `expect ${step.surface} hidden`;
    case "expectText":
      return `expect ${step.surface}.${step.id} text ${JSON.stringify(step.text)}`;
    case "expectValue":
      return `expect ${step.surface}.${step.id} value ${formatFillValue(step.value)}`;
    case "expectPageText":
      return `expect text ${JSON.stringify(step.text)}`;
    case "expectPath":
      return `expect path ${step.path}`;
    case "screenshot": {
      const quoted = step.label
        ? /\s/.test(step.label)
          ? JSON.stringify(step.label)
          : step.label
        : undefined;
      if (step.ui) return quoted ? `screenshot ui ${quoted}` : "screenshot ui";
      return quoted ? `screenshot ${quoted}` : "screenshot";
    }
  }
}

export function parseLog(text: string): Log {
  const comments: string[] = [];
  let bug: string | undefined;
  let found: string | undefined;
  const steps: Step[] = [];
  const lines = text.split(/\r?\n/);
  let inBug = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) {
      const c = trimmed.slice(1).trim();
      const bugMatch = c.match(/^bug:\s*(.+)$/i);
      const foundMatch = c.match(/^found:\s*(.+)$/i);
      if (bugMatch?.[1]) {
        bug = bugMatch[1].trim();
        inBug = true;
      } else if (foundMatch?.[1]) {
        found = foundMatch[1].trim();
        inBug = false;
      } else if (inBug && steps.length === 0) {
        bug = `${bug ?? ""}\n${c}`.trim();
      } else if (c) comments.push(c);
      continue;
    }
    try {
      const parsed = parseLine(raw, i + 1);
      if (!parsed) continue;
      if ("comment" in parsed) continue;
      inBug = false;
      steps.push(parsed);
    } catch (err) {
      if (inBug && steps.length === 0) {
        bug = `${bug ?? ""}\n${stripAnsi(trimmed)}`.trim();
        continue;
      }
      throw err;
    }
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
  if (log.bug) out.push(`# bug: ${oneLineBug(log.bug)}`);
  if (log.found) out.push(`# found: ${oneLineBug(log.found)}`);
  for (const c of log.comments) out.push(`# ${oneLineBug(c)}`);
  if (out.length && log.steps.length) out.push("");
  for (const step of log.steps) out.push(formatStep(step));
  if (out.length === 0 || out[out.length - 1] !== "") out.push("");
  return out.join("\n");
}
