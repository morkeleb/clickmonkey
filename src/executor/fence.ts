export type FenceHit = "ok" | "blacklist" | "leftPath";

/** Pathname prefix with a segment boundary: `/app` matches `/app` and `/app/x`, not `/application`. */
export function pathPrefixMatch(pathname: string, prefix: string): boolean {
  const path = normalizePath(pathname);
  const pre = normalizePath(prefix);
  if (pre === "/") return true;
  return path === pre || path.startsWith(`${pre}/`);
}

function normalizePath(path: string): string {
  if (path === "") return "/";
  if (path !== "/" && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

/**
 * fence.path is the URL pathname only. Hash-route apps use blacklist.
 */
export function checkFence(
  href: string,
  fence?: { path?: string; blacklist?: string[] },
): FenceHit {
  if (!fence) return "ok";
  if (fence.blacklist?.some((entry) => href.includes(entry))) return "blacklist";
  if (fence.path) {
    let pathname = href;
    try {
      pathname = new URL(href).pathname;
    } catch {
      // already a path
    }
    if (!pathPrefixMatch(pathname, fence.path)) return "leftPath";
  }
  return "ok";
}
