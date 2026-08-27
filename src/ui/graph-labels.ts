export function titleCaseSegment(seg: string): string {
  return seg
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const ACRONYMS = new Set(["ui", "http", "html", "id", "url", "seo", "wcag", "dom", "aria"]);

/** `visualIssue` / `nested-interactive` → `Visual Issue` / `Nested Interactive`. */
export function prettyIdent(raw: string): string {
  const spaced = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();
  if (!spaced) return raw;
  return spaced
    .split(/\s+/)
    .map((w) => {
      const lower = w.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/** `implicitSubmit: Button Cancel…` → `Implicit Submit: Button Cancel…`. */
export function prettyLeadingIdent(text: string): string {
  const m = /^([A-Za-z][A-Za-z0-9_-]*)(:\s*)([\s\S]*)$/.exec(text);
  if (!m) return text;
  const ident = m[1]!;
  if (!/[A-Z]/.test(ident.slice(1)) && !/[-_]/.test(ident)) return text;
  return `${prettyIdent(ident)}${m[2]}${m[3]}`;
}

export function pathSegments(path: string): string[] {
  return path.replace(/\/+$/, "").split("/").filter(Boolean);
}

/** First path segment, used to cluster /accounts-payable/* etc. */
export function sectionKey(path: string): string | undefined {
  return pathSegments(path)[0];
}

/** Last segments that are not a unique room name (`/vendors/new` vs `/vouchers/new`). */
const GENERIC_LEAF = new Set(["new", "edit", "create", "add", "form", "show", "index", "settings"]);

export function prettyPageLabel(path: string, fallback: string): { title: string; kicker?: string } {
  const segs = pathSegments(path).filter((s) => !s.startsWith(":"));
  if (segs.length === 0) {
    return { title: fallback === "home" ? "Home" : titleCaseSegment(fallback) };
  }
  if (segs.length === 1) return { title: titleCaseSegment(segs[0]!) };
  const kicker = titleCaseSegment(segs[0]!);
  const rest = segs.slice(1);
  const leaf = rest[rest.length - 1]!.toLowerCase();
  if (rest.length >= 2 && GENERIC_LEAF.has(leaf)) {
    return { title: rest.map(titleCaseSegment).join(" / "), kicker };
  }
  return { title: titleCaseSegment(segs[segs.length - 1]!), kicker };
}
