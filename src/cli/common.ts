import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, saveConfig } from "../persist/config.js";
import { newRunId } from "../persist/run-id.js";
import { runsDir, WORKSPACE_DIR } from "../persist/workspace.js";
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
  init        Create clickmonkey.json + clickmonkey/ (leash, empty map)
  inspect     Survey the current page and grow the map
  view        Print the compact view of the current surface
  step        Run one DSL line and append it to the log
  playbook    Run a named playbook (empty-required)
  map         Scout: navigate-only walk — grow the sitemap, no fill/submit
  unleash     NPC: hunt mapped forms, fill and submit [--nasty rogue payloads]
  explore     Paladin: charter-driven LLM walk of legal map ids
  mcp         Exploratory testing over MCP (stdio)
  report      Markdown findings report from selected runs (folder under clickmonkey/reports/)
  replay      Replay a log file or a findings-report markdown file
  spec        Markdown specs under clickmonkey/specs/ [--check] [--fail-on-findings]
  compact     Shorten a log to the last open or nav click + following lines
  bundle      Static dashboard folder (open without the CLI)
  ui          Local-only dashboard (map, runs, findings) [--stop]

Options:
  --verbose   Write per-step HTML + view dumps under <run>/verbose/

Run clickmonkey <command> --help for command options.
`;

export function printUsage(extra?: string): void {
  process.stdout.write(extra ? `${extra}\n` : USAGE);
}

export function resolveConfigPath(value?: string): string {
  return resolve(process.cwd(), value ?? "clickmonkey.json");
}

export function resolveOutDir(value?: string, configPath?: string): string {
  if (value) return resolve(process.cwd(), value);
  const root = configPath ? runsDir(configPath) : resolve(process.cwd(), WORKSPACE_DIR, "runs");
  return resolve(root, newRunId());
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
  if (url) saveConfig(configPath, next, { persistUrl: true });
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

export function parsePort(value?: string, fallback = 4174): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) fail(EXIT_USAGE, `invalid --port ${value}`);
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

Explore pings the model before opening a browser. A missing key or a down
endpoint is a hard error (exit 2), not a screenshot walk.
`;

export const VISION_HELP = `vision is optional. Same connection shape as brain (baseUrl, model, apiKeyEnv).

  model is required on the vision block and is never copied from brain.
  baseUrl inherits from brain when omitted.
  apiKeyEnv inherits from brain only when vision.baseUrl is also omitted
  (same host). A different vision.baseUrl does not copy the brain key.
  "apiKeyEnv": false means no key.

  Mix local models (qwen text + qwen-vl on another host):
  "brain":  { "baseUrl": "http://127.0.0.1:11434/v1", "model": "qwen2.5" }
  "vision": { "baseUrl": "http://127.0.0.1:8080/v1", "model": "qwen2.5-vl" }

issues (default true) writes extras into that run's quality.json.
High-confidence visual extras are also filed as findings with the step screenshot.
Medium stays on the quality ledger. The walk does not stop.
assist (default true) adds explore sight notes.
Per-step screenshots must stay on (the default).
decide stays text-only.
`;

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
