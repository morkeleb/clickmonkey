import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, relative, resolve, sep } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

export async function serveDirectory(
  dir: string,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    void handle(root, req, res);
  });

  await new Promise<void>((resolveListen, reject) => {
    const onError = (err: Error) => reject(err);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolveListen();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a TCP listen address");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolveClose, reject) => {
        server.close((err) => (err ? reject(err) : resolveClose()));
      }),
  };
}

function notFound(res: ServerResponse): void {
  res.writeHead(404);
  res.end("Not found");
}

function resolveSafePath(root: string, pathname: string): string | undefined {
  const filePath = resolve(root, pathname.replace(/^\/+/, ""));
  const rel = relative(root, filePath);
  if (rel.startsWith("..") || rel.startsWith(sep)) return undefined;
  return filePath;
}

async function handle(root: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
  } catch {
    notFound(res);
    return;
  }

  if (pathname === "/") pathname = "/index.html";

  const filePath = resolveSafePath(root, pathname);
  if (!filePath) {
    notFound(res);
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      notFound(res);
      return;
    }
    const body = await readFile(filePath);
    const type = CONTENT_TYPES[extname(filePath).toLowerCase()];
    res.writeHead(200, type ? { "Content-Type": type } : undefined);
    res.end(body);
  } catch {
    notFound(res);
  }
}
