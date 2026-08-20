export function titleCaseSegment(seg: string): string {
  return seg
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function pathSegments(path: string): string[] {
  return path.replace(/\/+$/, "").split("/").filter(Boolean);
}

/** First path segment, used to cluster /accounts-payable/* etc. */
export function sectionKey(path: string): string | undefined {
  return pathSegments(path)[0];
}

export function prettyPageLabel(path: string, fallback: string): { title: string; kicker?: string } {
  const segs = pathSegments(path).filter((s) => !s.startsWith(":"));
  if (segs.length === 0) {
    return { title: fallback === "home" ? "Home" : titleCaseSegment(fallback) };
  }
  if (segs.length === 1) return { title: titleCaseSegment(segs[0]!) };
  return { title: titleCaseSegment(segs[segs.length - 1]!), kicker: titleCaseSegment(segs[0]!) };
}
