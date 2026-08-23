import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { workspaceDir } from "../persist/workspace.js";

function packageRoot(): string {
  return fileURLToPath(new URL("../..", import.meta.url));
}

export const UI_PID_NAME = "ui.pid";

export type UiPidRecord = { pid: number; port: number };

export function uiPidPath(configPath: string): string {
  return join(workspaceDir(configPath), UI_PID_NAME);
}

export function readUiPid(configPath: string): UiPidRecord | undefined {
  try {
    const raw = JSON.parse(readFileSync(uiPidPath(configPath), "utf8")) as unknown;
    if (!raw || typeof raw !== "object") return undefined;
    const rec = raw as { pid?: unknown; port?: unknown };
    const pid = rec.pid;
    const port = rec.port;
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return undefined;
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
      return undefined;
    }
    return { pid, port };
  } catch {
    return undefined;
  }
}

export function writeUiPid(configPath: string, rec: UiPidRecord): void {
  mkdirSync(workspaceDir(configPath), { recursive: true });
  writeFileSync(uiPidPath(configPath), `${JSON.stringify(rec)}\n`, "utf8");
}

export function clearUiPid(configPath: string, pid = process.pid): void {
  const rec = readUiPid(configPath);
  if (!rec || rec.pid !== pid) return;
  try {
    unlinkSync(uiPidPath(configPath));
  } catch {
    // already gone
  }
}

export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function processCommandLine(pid: number): string {
  if (process.platform === "win32") return "";
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

export function processLooksLikeUi(pid: number): boolean {
  const cmd = processCommandLine(pid);
  if (!cmd) return false;
  return /\bui\b/.test(cmd) && /clickmonkey|cli\/index\.[cm]?[jt]s/.test(cmd);
}

function listenerPids(port: number): number[] {
  if (process.platform === "win32") return [];
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const pids = new Set<number>();
    for (const line of out.split("\n").slice(1)) {
      if (!line.includes(`:${port}`)) continue;
      const pid = Number(line.trim().split(/\s+/)[1]);
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
    return [...pids];
  } catch {
    return [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function killAndWait(pid: number): Promise<boolean> {
  if (pid === process.pid) return false;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return !processIsAlive(pid);
  }
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) return true;
    await sleep(50);
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // already gone
  }
  await sleep(50);
  return !processIsAlive(pid);
}

export async function stopUi(opts: { configPath?: string; port: number }): Promise<{
  stopped: boolean;
  pid?: number;
  port: number;
  reason: string;
}> {
  const port = opts.port;
  const fromFile = opts.configPath ? readUiPid(opts.configPath) : undefined;
  const candidates: number[] = [];
  if (fromFile && fromFile.port === port && processLooksLikeUi(fromFile.pid)) {
    candidates.push(fromFile.pid);
  }
  for (const pid of listenerPids(port)) {
    if (!candidates.includes(pid) && processLooksLikeUi(pid)) candidates.push(pid);
  }
  for (const pid of candidates) {
    if (!processIsAlive(pid)) continue;
    const ok = await killAndWait(pid);
    if (ok) {
      if (opts.configPath) clearUiPid(opts.configPath, pid);
      return { stopped: true, pid, port, reason: `stopped pid ${pid}` };
    }
  }
  if (opts.configPath) {
    const stale = readUiPid(opts.configPath);
    if (stale && !processIsAlive(stale.pid)) clearUiPid(opts.configPath, stale.pid);
  }
  return { stopped: false, port, reason: `no clickmonkey ui on 127.0.0.1:${port}` };
}

export function uiSpawnArgs(opts: { configPath: string; port: number }): { execPath: string; args: string[] } {
  const rest = ["ui", "--config", opts.configPath, "--port", String(opts.port), "--no-open"];
  const bin = join(packageRoot(), "bin", "clickmonkey.mjs");
  // Re-enter the bin so src-vs-dist is rechecked. Respawning argv[1] (often dist) keeps a stale schema.
  if (existsSync(bin)) return { execPath: process.execPath, args: [bin, ...rest] };
  const script = process.argv[1];
  const args = [...process.execArgv];
  if (script) args.push(script);
  args.push(...rest);
  return { execPath: process.execPath, args };
}

export function spawnDetachedUi(opts: { configPath: string; port: number }): void {
  const { execPath, args } = uiSpawnArgs(opts);
  const child = spawn(execPath, args, {
    detached: true,
    stdio: "ignore",
    cwd: process.cwd(),
    env: process.env,
  });
  child.unref();
}
