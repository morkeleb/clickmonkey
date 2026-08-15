import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, saveConfig } from "../persist/config.js";
import { newRunId } from "../persist/run-id.js";
import { Config, LegacyConfigError } from "../schema/config.js";
import { version } from "../index.js";

export const EXIT_OK = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_USAGE = 2;
export const EXIT_LIVE = 3;

export const USAGE = `clickmonkey ${version}

Usage:
  clickmonkey <command> [options]

Commands:
  init        Create clickmonkey.json (fence + empty intro + empty map)
  inspect     Survey the current page and grow the map
  view        Print the compact view of the current surface
  step        Run one DSL line and append it to the log
  playbook    Run a named playbook (empty-required)
  unleash     Random-walk legal map ids from the view
  explore     Charter-driven LLM walk of legal map ids
  replay      Replay a log file (no brain)
  compact     Shorten a log to the last open + following lines

Run clickmonkey <command> --help for command options.
`;

export function printUsage(extra?: string): void {
  process.stdout.write(extra ? `${extra}\n` : USAGE);
}

export function resolveConfigPath(value?: string): string {
  return resolve(process.cwd(), value ?? "clickmonkey.json");
}

export function resolveOutDir(value?: string): string {
  return value ? resolve(process.cwd(), value) : resolve(process.cwd(), "runs", newRunId());
}

export function fail(code: number, message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

export function loadConfigOrExit(path: string): Config {
  if (!existsSync(path)) fail(EXIT_USAGE, `config not found: ${path}`);
  try {
    return loadConfig(path);
  } catch (err) {
    if (err instanceof LegacyConfigError) fail(EXIT_USAGE, err.message);
    fail(EXIT_USAGE, err instanceof Error ? err.message : String(err));
  }
}

export function withUrl(config: Config, url?: string): Config {
  if (!url) return config;
  return Config.parse({ ...config, url });
}

export function persistUrl(configPath: string, config: Config, url?: string): Config {
  const next = withUrl(config, url);
  if (url) saveConfig(configPath, next);
  return next;
}

export function parseTimeout(value?: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) fail(EXIT_USAGE, `invalid --timeout ${value}`);
  return n;
}

export function parseSteps(value?: string, fallback = 200): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) fail(EXIT_USAGE, `invalid --steps ${value}`);
  return n;
}

export function parseMinutes(value?: string, fallback = 20): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) fail(EXIT_USAGE, `invalid --minutes ${value}`);
  return n;
}

export const BRAIN_HELP = `explore requires brain.baseUrl and brain.model in clickmonkey.json.

  Provider    baseUrl                         apiKeyEnv
  Ollama      http://127.0.0.1:11434/v1
  MLX         http://127.0.0.1:8080/v1
  xAI         https://api.x.ai/v1             XAI_API_KEY
  OpenAI      https://api.openai.com/v1       OPENAI_API_KEY
  Anthropic   https://api.anthropic.com       ANTHROPIC_API_KEY

Example:
  "brain": { "baseUrl": "http://127.0.0.1:11434/v1", "model": "llama3.2" }
`;

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
