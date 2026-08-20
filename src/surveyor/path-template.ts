/** Split a pathname into segments, keeping a leading "" so `/a` and `a` stay distinct. */
export function splitPath(path: string): string[] {
  const trimmed = path.replace(/\/+$/, "");
  if (trimmed === "" || trimmed === "/") return [""];
  return trimmed.split("/");
}

export function joinPath(segs: readonly string[]): string {
  if (segs.length === 0 || (segs.length === 1 && segs[0] === "")) return "/";
  return segs.join("/") || "/";
}

/**
 * Instance token, not a vocabulary segment like `migrations` or `profile`.
 * UUIDs, ulids, mongo ids, long hex, and mixed alnum with digits.
 */
export function looksParametric(seg: string): boolean {
  if (!seg || seg.startsWith(":")) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return true;
  if (/^[0-9a-f]{24}$/i.test(seg)) return true;
  if (/^[0-9a-hjkmnp-tv-z]{26}$/i.test(seg)) return true;
  if (/^\d{3,}$/.test(seg)) return true;
  if (seg.length >= 8 && /\d/.test(seg) && /[a-z]/i.test(seg)) return true;
  if (seg.length >= 12 && /^[0-9a-f]+$/i.test(seg)) return true;
  return false;
}

export function pathHasParams(page: { path: string; params?: readonly string[] }): boolean {
  if ((page.params ?? []).length > 0) return true;
  return /(^|\/):[A-Za-z_]/.test(page.path);
}

/**
 * Turn `/customers/<token>/migrations` into `/customers/:id1/migrations`.
 * Only slots that look parametric, and only when a static neighbor exists
 * (`migrations`, `customers`) so `/settings/profile` stays a real page.
 */
/** Pathname as quality/testability ledger key (`/customers/:id1/migrations`). */
export function ledgerPath(pathname: string): string {
  return templatizePath(pathname).path;
}

export function templatizePath(pathname: string): { path: string; params: string[] } {
  const segs = splitPath(pathname);
  const hasStatic = segs.some(
    (s, i) => !(i === 0 && s === "") && Boolean(s) && !s.startsWith(":") && !looksParametric(s),
  );
  if (!hasStatic) {
    const path = pathname === "" ? "/" : pathname;
    return { path, params: [] };
  }
  const params: string[] = [];
  const out = segs.map((seg, i) => {
    if (i === 0 && seg === "") return "";
    if (seg.startsWith(":")) {
      const name = seg.slice(1);
      if (name && !params.includes(name)) params.push(name);
      return seg;
    }
    if (!looksParametric(seg)) return seg;
    const name = `id${params.length + 1}`;
    params.push(name);
    return `:${name}`;
  });
  return { path: joinPath(out), params };
}
