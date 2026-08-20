import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrainContext, BrainDecision } from "./types.js";
import { decideUnleashWork } from "./unleash.js";

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

export interface NastyCatalogInfo {
  id: string;
  count: number;
  description: string;
}

const CATALOG_DESCRIPTIONS: Record<string, string> = {
  xss: "cross-site script fragments",
  sqli: "SQL injection fragments",
  format: "emails, numbers, dates, junk formats",
  overlong: "huge strings",
  "control-chars": "NUL / CR / LF / TAB tokens",
};

const SAMPLE_MAX_CHARS = 120;
const SAMPLE_DEFAULT_LIMIT = 6;

export function listCatalogs(dir?: string): NastyCatalogInfo[] {
  const catalog = loadPayloads(dir);
  return Object.keys(catalog)
    .sort()
    .map((id) => ({
      id,
      count: catalog[id]!.length,
      description: CATALOG_DESCRIPTIONS[id] ?? "payload catalog",
    }));
}

export function samplePayloads(id: string, opts?: { limit?: number; dir?: string }): string[] {
  const catalog = loadPayloads(opts?.dir);
  const lines = catalog[id];
  if (!lines) return [];
  const limit = opts?.limit ?? SAMPLE_DEFAULT_LIMIT;
  const out: string[] = [];
  for (const line of lines) {
    if (line.length > SAMPLE_MAX_CHARS) continue;
    out.push(line);
    if (out.length >= limit) break;
  }
  return out;
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

/** Same form-then-button order as decideUnleash; fills use pickNasty. */
export function decideUnleashNasty(ctx: BrainContext, rng: () => number = Math.random): BrainDecision {
  return decideUnleashWork(ctx, rng, (type) => pickNasty(type, rng));
}
