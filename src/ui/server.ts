import { spawn } from "node:child_process";
import {
  existsSync,
  readFileSync,
  statSync,
  watch,
  type FSWatcher,
} from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runsDir, workspaceDir, WORKSPACE_DIR } from "../persist/workspace.js";
import { UiSnapshot, type UiEvent, type UiEventType, type UiSnapshot as UiSnapshotT } from "../schema/ui.js";
import { isSafeReportId, readReport } from "../persist/reports.js";
import { formatUiFault, snapshotFailNotice, sourceNewerThanStarted, staleUiNotice } from "./fault.js";
import { clearUiPid, spawnDetachedUi, writeUiPid } from "./pid.js";
import { buildRunDetail, isSafeRunId } from "./run-detail.js";
import { buildUiSnapshot, refreshUiSnapshot } from "./snapshot.js";

export const UI_DEFAULT_PORT = 4174;
const HEARTBEAT_MS = 15_000;
const DEBOUNCE_MS = 100;

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export interface UiServerOpts {
  configPath: string;
  port?: number;
  open?: boolean;
  spawnRestart?: (opts: { configPath: string; port: number }) => void;
}

export interface UiServer {
  url: string;
  close(): Promise<void>;
  /** Resolves when the server stops (SIGINT, --stop, or Restart UI). */
  stopped: Promise<void>;
}

function packageRoot(): string {
  return fileURLToPath(new URL("../..", import.meta.url));
}

export function resolveUiRoot(): string | undefined {
  const pkg = packageRoot();
  const distUi = join(pkg, "dist", "ui");
  if (existsSync(join(distUi, "index.html"))) return distUi;
  const webDist = join(pkg, "web", "dist");
  if (existsSync(webDist)) return webDist;
  return undefined;
}

function contentType(filePath: string): string | undefined {
  return CONTENT_TYPES[extname(filePath).toLowerCase()];
}

function send(res: ServerResponse, status: number, body: string | Buffer, type?: string): void {
  const headers: Record<string, string | number> = { "Content-Length": Buffer.byteLength(body) };
  if (type) headers["Content-Type"] = type;
  res.writeHead(status, headers);
  res.end(body);
}

function eventTypeOf(filename: string | null): UiEventType | undefined {
  if (!filename) return undefined;
  const norm = filename.replaceAll("\\", "/");
  if (norm.includes("verbose")) return undefined;
  const base = basename(norm);
  if (base.endsWith(".tmp")) {
    if (base.startsWith("presence.json")) return "nav";
    return undefined;
  }
  if (base === "map.json") return "map";
  if (base === "testability.json") return "testability";
  if (base === "quality.json") return "quality";
  if (base === "findings.md" || base === "report.json" || base === "finding.json" || base === "replay.log") {
    return "run";
  }
  if (base === "nav.jsonl" || base === "presence.json" || base === "log.txt") return "nav";
  return undefined;
}

function writeSse(res: ServerResponse, event: UiEvent): void {
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function openBrowser(url: string): void {
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(opener, [url], { stdio: "ignore", detached: true });
  child.on("error", () => undefined);
  child.unref();
}

function safeRunFile(runsRoot: string, rel: string): string | undefined {
  if (!rel || rel.includes("\0") || rel.includes("..") || rel.includes("verbose")) return undefined;
  const root = resolve(runsRoot);
  const abs = resolve(root, rel);
  const relToRoot = relative(root, abs);
  if (relToRoot.startsWith("..") || relToRoot.startsWith(sep) || relToRoot.includes("verbose")) {
    return undefined;
  }
  return abs;
}

function serveFile(res: ServerResponse, filePath: string): void {
  try {
    const info = statSync(filePath);
    if (!info.isFile()) {
      send(res, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }
    const body = readFileSync(filePath);
    send(res, 200, body, contentType(filePath));
  } catch {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
}

function decorateSnapshot(snapshot: UiSnapshotT, startedAtMs: number, fail?: unknown): UiSnapshotT {
  const notice = fail
    ? snapshotFailNotice(fail)
    : sourceNewerThanStarted(startedAtMs)
      ? staleUiNotice()
      : undefined;
  if (!notice) {
    if (!snapshot.notice) return snapshot;
    const { notice: _drop, ...rest } = snapshot;
    return UiSnapshot.parse(rest);
  }
  return UiSnapshot.parse({ ...snapshot, notice });
}

export async function startUiServer(opts: UiServerOpts): Promise<UiServer> {
  const configPath = resolve(opts.configPath);
  const port = opts.port ?? UI_DEFAULT_PORT;
  const startedAtMs = Date.now();
  const clients = new Set<ServerResponse>();
  const watchers: FSWatcher[] = [];
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let pendingType: UiEventType = "run";
  let lastSnapshot: ReturnType<typeof buildUiSnapshot> | undefined;
  try {
    lastSnapshot = buildUiSnapshot(configPath);
  } catch {
    lastSnapshot = undefined;
  }

  const snapshotNow = (): NonNullable<typeof lastSnapshot> => {
    lastSnapshot = buildUiSnapshot(configPath);
    return lastSnapshot;
  };

  const liveSnapshot = (): { snapshot?: UiSnapshotT; fail?: unknown } => {
    try {
      const raw = lastSnapshot ?? snapshotNow();
      return { snapshot: decorateSnapshot(raw, startedAtMs) };
    } catch (err) {
      if (!lastSnapshot) return { fail: err };
      return { snapshot: decorateSnapshot(lastSnapshot, startedAtMs, err), fail: err };
    }
  };

  const broadcast = (type: UiEventType): void => {
    if (type === "map") lastSnapshot = undefined;
    else if (lastSnapshot) {
      try {
        if (type === "nav") {
          lastSnapshot = refreshUiSnapshot(lastSnapshot, configPath, "runs");
          const event: UiEvent = { type, runs: lastSnapshot.runs };
          for (const client of clients) writeSse(client, event);
          return;
        }
        if (type === "quality") {
          lastSnapshot = refreshUiSnapshot(lastSnapshot, configPath, "quality");
          for (const client of clients) writeSse(client, { type });
          return;
        }
        if (type === "testability") {
          lastSnapshot = refreshUiSnapshot(lastSnapshot, configPath, "testability");
          for (const client of clients) writeSse(client, { type });
          return;
        }
        if (type === "run") {
          lastSnapshot = refreshUiSnapshot(lastSnapshot, configPath, "findings");
        }
      } catch {
        lastSnapshot = undefined;
      }
    }
    const { snapshot } = liveSnapshot();
    if (!snapshot) return;
    const event: UiEvent = { type, snapshot };
    for (const client of clients) writeSse(client, event);
  };

  const schedule = (type: UiEventType): void => {
    if (type === "map") pendingType = "map";
    else if (pendingType !== "map" && type === "run") pendingType = "run";
    else if (pendingType !== "map" && pendingType !== "run") pendingType = type;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = undefined;
      const t = pendingType;
      pendingType = "nav";
      broadcast(t);
    }, DEBOUNCE_MS);
  };

  const watchPath = (path: string, recursive: boolean): void => {
    if (!existsSync(path)) return;
    try {
      watchers.push(
        watch(path, { persistent: true, recursive }, (_event, filename) => {
          const type = eventTypeOf(typeof filename === "string" ? filename : null);
          if (!type) return;
          schedule(type);
        }),
      );
    } catch {
      // platform may reject recursive watch; ignore
    }
  };

  const ws = workspaceDir(configPath);
  const runs = runsDir(configPath);
  watchPath(ws, true);
  if (!existsSync(ws)) {
    watchPath(dirname(ws), false);
    try {
      watchers.push(
        watch(dirname(configPath), { persistent: true }, (_event, filename) => {
          if (filename === WORKSPACE_DIR || filename === basename(ws)) watchPath(ws, true);
        }),
      );
    } catch {
      // ignore
    }
  }
  if (existsSync(runs) && !existsSync(ws)) watchPath(runs, true);

  const server = createServer((req, res) => {
    handle(req, res);
  });

  let boundPort = port;
  let closeServer: () => Promise<void> = async () => undefined;

  function handle(req: IncomingMessage, res: ServerResponse): void {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://127.0.0.1");
    } catch {
      send(res, 400, "Bad request", "text/plain; charset=utf-8");
      return;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      send(res, 400, "Bad request", "text/plain; charset=utf-8");
      return;
    }

    if (pathname === "/api/restart") {
      if (req.method !== "POST") {
        send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
        return;
      }
      send(res, 202, `${JSON.stringify({ ok: true, restarting: true })}\n`, "application/json; charset=utf-8");
      void closeServer().then(() => {
        const spawn = opts.spawnRestart ?? spawnDetachedUi;
        spawn({ configPath, port: boundPort });
      });
      return;
    }

    if (req.method && req.method !== "GET" && req.method !== "HEAD") {
      send(res, 405, "Method not allowed", "text/plain; charset=utf-8");
      return;
    }

    if (pathname.startsWith("/api/reports/")) {
      const reportId = pathname.slice("/api/reports/".length);
      if (!isSafeReportId(reportId)) {
        send(res, 400, "Bad report id", "text/plain; charset=utf-8");
        return;
      }
      const loaded = readReport(configPath, reportId);
      if (!loaded) {
        send(res, 404, "Report not found", "text/plain; charset=utf-8");
        return;
      }
      send(
        res,
        200,
        `${JSON.stringify({ ...loaded.meta, markdown: loaded.markdown })}\n`,
        "application/json; charset=utf-8",
      );
      return;
    }

    if (pathname.startsWith("/api/runs/")) {
      const runId = pathname.slice("/api/runs/".length);
      if (!isSafeRunId(runId)) {
        send(res, 400, "Bad run id", "text/plain; charset=utf-8");
        return;
      }
      try {
        const detail = buildRunDetail(configPath, runId);
        if (!detail) {
          send(res, 404, "Run not found", "text/plain; charset=utf-8");
          return;
        }
        send(res, 200, `${JSON.stringify(detail)}\n`, "application/json; charset=utf-8");
      } catch (err) {
        send(
          res,
          500,
          err instanceof Error ? err.message : String(err),
          "text/plain; charset=utf-8",
        );
      }
      return;
    }

    if (pathname === "/api/snapshot") {
      const { snapshot, fail } = liveSnapshot();
      if (snapshot) {
        send(res, 200, `${JSON.stringify(snapshot)}\n`, "application/json; charset=utf-8");
        return;
      }
      const fault = formatUiFault(fail);
      send(res, 503, `${JSON.stringify(fault)}\n`, "application/json; charset=utf-8");
      return;
    }

    if (pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(":\n\n");
      const { snapshot } = liveSnapshot();
      writeSse(res, snapshot ? { type: "hello", snapshot } : { type: "hello" });
      clients.add(res);
      const heartbeat = setInterval(() => {
        res.write(":\n\n");
      }, HEARTBEAT_MS);
      heartbeat.unref();
      req.on("close", () => {
        clearInterval(heartbeat);
        clients.delete(res);
      });
      return;
    }

    if (pathname === "/files" || pathname.startsWith("/files/")) {
      const prefix = "/files/runs/";
      if (!pathname.startsWith(prefix)) {
        send(res, 404, "Not found", "text/plain; charset=utf-8");
        return;
      }
      const rel = pathname.slice(prefix.length);
      const abs = safeRunFile(runsDir(configPath), rel);
      if (!abs) {
        send(res, 403, "Forbidden", "text/plain; charset=utf-8");
        return;
      }
      serveFile(res, abs);
      return;
    }

    const root = resolveUiRoot();
    if (!root) {
      send(res, 404, "ui not built", "text/plain; charset=utf-8");
      return;
    }
    const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const candidate = resolve(root, rel);
    const relToRoot = relative(root, candidate);
    if (relToRoot.startsWith("..") || relToRoot.startsWith(sep)) {
      send(res, 403, "Forbidden", "text/plain; charset=utf-8");
      return;
    }
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      serveFile(res, candidate);
      return;
    }
    if (pathname.startsWith("/api/") || pathname.endsWith(".json")) {
      send(res, 404, "Not found", "text/plain; charset=utf-8");
      return;
    }
    serveFile(res, join(root, "index.html"));
  }

  await new Promise<void>((resolveListen, reject) => {
    const onError = (err: Error) => {
      const code = "code" in err ? String(err.code) : "";
      if (code === "EADDRINUSE") {
        reject(
          new Error(
            `port ${port} is already in use (another clickmonkey ui?). Run clickmonkey ui --stop and retry.`,
          ),
        );
        return;
      }
      reject(err);
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", onError);
      resolveListen();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP listen address");
  }
  boundPort = address.port;
  const url = `http://127.0.0.1:${boundPort}/`;
  writeUiPid(configPath, { pid: process.pid, port: boundPort });
  process.stdout.write(`${url}\n`);
  if (opts.open) openBrowser(url);

  const poll = setInterval(() => schedule("run"), 1000);
  poll.unref();

  let settleStopped: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    settleStopped = resolve;
  });
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closing) return closing;
    closing = new Promise<void>((resolveClose, reject) => {
      clearInterval(poll);
      if (debounce) clearTimeout(debounce);
      for (const watcher of watchers) watcher.close();
      for (const client of clients) client.end();
      clients.clear();
      clearUiPid(configPath);
      server.closeAllConnections();
      server.close((err) => {
        settleStopped();
        if (err) reject(err);
        else resolveClose();
      });
    });
    return closing;
  };

  closeServer = close;
  return { url, close, stopped };
}
