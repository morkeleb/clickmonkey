/** Resolve a site-root path against the page (works at / and on GitLab Pages). */
export function publicUrl(path: string): string {
  const rel = path.replace(/^\//, "");
  return new URL(rel, document.baseURI).href;
}

export async function fetchFirstJson<T>(paths: string[]): Promise<T> {
  let last = "not found";
  for (const path of paths) {
    try {
      const res = await fetch(publicUrl(path));
      if (res.ok) return (await res.json()) as T;
      last = `${path} ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(last);
}
