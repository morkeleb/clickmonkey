/** Resolve a site-root path against the page (works at / and on GitLab Pages). */
export function publicUrl(path: string): string {
  const rel = path.replace(/^\//, "");
  return new URL(rel, new URL("./", document.baseURI)).href;
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

export async function fetchFirstJson<T>(paths: string[]): Promise<T> {
  let last = "not found";
  for (const path of paths) {
    try {
      const res = await fetch(publicUrl(path));
      const text = await res.text();
      if (!res.ok) {
        const detail = text.trim().replace(/\s+/g, " ").slice(0, 180);
        last = detail ? `${path} ${res.status}: ${detail}` : `${path} ${res.status}`;
        continue;
      }
      try {
        return parseJsonBody(res.headers.get("content-type"), text) as T;
      } catch (err) {
        last = err instanceof Error ? err.message : String(err);
      }
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(last);
}
