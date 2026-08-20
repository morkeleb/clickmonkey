/** Resolve a site-root path against the page (works at / and on GitLab Pages). */
export function publicUrl(path: string): string {
  const rel = path.replace(/^\//, "");
  const base = globalThis.document?.baseURI ?? "http://127.0.0.1/";
  return new URL(rel, new URL("./", base)).href;
}

/** CLI SPA fallback serves index.html for missing paths; do not parse that as JSON. */
export function parseJsonBody(contentType: string | null, body: string): unknown {
  const type = (contentType ?? "").toLowerCase();
  const start = body.trimStart();
  if (type.includes("text/html") || start.startsWith("<")) {
    throw new Error("not json");
  }
  return JSON.parse(body) as unknown;
}

export class UiHttpError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(path: string, status: number, body: string) {
    super(`${path} ${status}`);
    this.name = "UiHttpError";
    this.status = status;
    this.body = body;
  }
}

export async function fetchFirstJson<T>(paths: string[]): Promise<T> {
  let last: Error = new Error("not found");
  for (const path of paths) {
    try {
      const res = await fetch(publicUrl(path));
      const text = await res.text();
      if (!res.ok) {
        last = new UiHttpError(path, res.status, text.trim());
        if (res.status !== 404) throw last;
        continue;
      }
      try {
        return parseJsonBody(res.headers.get("content-type"), text) as T;
      } catch (err) {
        last = err instanceof Error ? err : new Error(String(err));
      }
    } catch (err) {
      if (err instanceof UiHttpError && err.status !== 404) throw err;
      last = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw last;
}
