/** Short DevTools-searchable locator. Not XPath (brittle, not how the monkey names widgets). */

const ATTR = (name: string) => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");

function attr(html: string, name: string): string | undefined {
  const m = html.match(ATTR(name));
  const v = m?.[1] ?? m?.[2] ?? m?.[3];
  const t = v?.trim();
  return t || undefined;
}

function clip(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length <= n ? one : `${one.slice(0, n - 1)}…`;
}

function generatedId(id: string): boolean {
  if (id.startsWith(":")) return true;
  if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) return true;
  return false;
}

/** Shared with the in-page audit so testability and quality `where` match. */
export const NAMED_WHERE_ATTRS = ["aria-label", "alt", "title", "name", "placeholder"] as const;

export function compactSelector(sel: string): string {
  const parts = sel
    .split(/\s*>\s*/)
    .map((p) => p.replace(/:nth-(?:child|of-type)\([^)]+\)/g, "").trim())
    .filter((p) => p && p !== "html" && p !== "body");
  return parts.slice(-3).join(" > ");
}

export function describeFromHtml(html: string): string | undefined {
  const tag = html.match(/^<\s*([a-zA-Z][a-zA-Z0-9:-]*)/)?.[1]?.toLowerCase();
  const hooks = ["data-testid", "data-test-id", "data-test", "data-cy"] as const;
  for (const name of hooks) {
    const hook = attr(html, name);
    if (hook) return `${tag ?? "el"}[${name}="${clip(hook, 40)}"]`;
  }
  const id = attr(html, "id");
  if (id && !generatedId(id)) return `#${clip(id, 40)}`;
  for (const name of NAMED_WHERE_ATTRS) {
    const named = attr(html, name);
    if (named && tag) return `${tag} "${clip(named, 40)}"`;
  }
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (text && tag) return `${tag} "${clip(text, 40)}"`;
  const href = attr(html, "href");
  if (href && tag) return `${tag}[href="${clip(href, 48)}"]`;
  const src = attr(html, "src");
  if (src && tag) return `${tag}[src="${clip(src, 48)}"]`;
  return tag;
}

export function describeQualityWhere(opts: { html?: string; selector?: string }): string | undefined {
  const fromHtml = opts.html ? describeFromHtml(opts.html) : undefined;
  if (fromHtml && (fromHtml.includes("data-testid") || fromHtml.startsWith("#") || fromHtml.includes('"'))) {
    return fromHtml;
  }
  const sel = opts.selector ? compactSelector(opts.selector) : undefined;
  if (fromHtml && sel && sel !== fromHtml) {
    if (sel.includes(" > ")) return `${fromHtml} (${sel})`;
    if (!sel.endsWith(fromHtml)) return `${fromHtml} (${sel})`;
  }
  return fromHtml ?? (sel || undefined);
}
