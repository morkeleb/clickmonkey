import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatStep } from "../schema/dsl.js";
import type { BrainContext, BrainDecision } from "./types.js";

const defaultDir = join(dirname(fileURLToPath(import.meta.url)), "../../payloads");

/**
 * Catalog files are plain text. {{NUL}} (and {{CR}}/{{LF}}/{{TAB}}) are written
 * as visible tokens so the files stay editable; pickNasty expands them.
 * These strings are not secrets — never log or print resolved $ENV secrets.
 */
const TOKENS: Record<string, string> = {
  "{{NUL}}": "\0",
  "{{CR}}": "\r",
  "{{LF}}": "\n",
  "{{TAB}}": "\t",
};

function interpret(raw: string): string {
  let out = raw;
  for (const [token, ch] of Object.entries(TOKENS)) out = out.split(token).join(ch);
  return out;
}

function parsePayloadFile(text: string): string[] {
  const lines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    lines.push(line.trimEnd());
  }
  return lines;
}

function readCatalog(dir: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!name.endsWith(".txt")) continue;
    const key = name.slice(0, -".txt".length);
    out[key] = parsePayloadFile(readFileSync(join(dir, name), "utf8"));
  }
  return out;
}

let cachedDefault: Record<string, string[]> | undefined;

export function loadPayloads(dir?: string): Record<string, string[]> {
  if (!dir && cachedDefault) return cachedDefault;
  const catalog = readCatalog(dir ?? defaultDir);
  if (!dir) cachedDefault = catalog;
  return catalog;
}

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)]!;
}

function poolFor(fieldType: string | undefined, catalog: Record<string, string[]>): string[] {
  const keys =
    fieldType === "email" || fieldType === "text" || fieldType === "textarea"
      ? ["xss", "sqli", "format", "overlong"]
      : fieldType === "number"
        ? ["overlong", "format"]
        : Object.keys(catalog);
  const items: string[] = [];
  for (const key of keys) items.push(...(catalog[key] ?? []));
  return items;
}

export function pickNasty(fieldType: string | undefined, rng: () => number = Math.random): string {
  const catalog = loadPayloads();
  const pool = poolFor(fieldType, catalog);
  if (pool.length === 0) return "";
  return interpret(pick(pool, rng));
}

/** Same 50% click / 30% fill / 20% click weights as decideUnleash; fills use pickNasty. */
export function decideUnleashNasty(ctx: BrainContext, rng: () => number = Math.random): BrainDecision {
  const { view } = ctx;
  const actions = view.actions;
  const fields = view.shown;
  const surface = view.surface;

  if (actions.length === 0 && fields.length === 0) {
    return { line: formatStep({ kind: "open", page: view.page }), note: "no legal widgets" };
  }

  const roll = rng();
  const wantFill = fields.length > 0 && roll >= 0.5 && roll < 0.8;
  if (wantFill || actions.length === 0) {
    const field = pick(fields, rng);
    return {
      line: formatStep({
        kind: "fill",
        surface,
        id: field.id,
        value: pickNasty(field.type, rng),
      }),
    };
  }

  const action = pick(actions, rng);
  return { line: formatStep({ kind: "click", surface, id: action.id }) };
}
