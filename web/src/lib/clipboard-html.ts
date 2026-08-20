/** Image srcs in rendered report HTML, skipping already-inlined data URLs. */
export function collectImgSrcs(html: string): string[] {
  const out: string[] = [];
  const re = /<img\b[^>]*?\bsrc=(["'])(.*?)\1/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const src = m[2]?.trim() ?? "";
    if (!src || /^data:/i.test(src)) continue;
    if (!out.includes(src)) out.push(src);
  }
  return out;
}

export function applySrcMap(html: string, map: Map<string, string>): string {
  return html.replace(/<img\b([^>]*?)\bsrc=(["'])(.*?)\2/gi, (_all, pre: string, q: string, src: string) => {
    const next = map.get(src) ?? src;
    return `<img${pre}src=${q}${next}${q}`;
  });
}

/** Raw destinations from markdown `![alt](url)`. */
export function collectMarkdownImageRaws(markdown: string): string[] {
  const out: string[] = [];
  const re = /!\[[^\]]*]\(([^)]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    const raw = m[1]?.trim() ?? "";
    if (!raw || /^data:/i.test(raw)) continue;
    if (!out.includes(raw)) out.push(raw);
  }
  return out;
}

export function rewriteMarkdownImageUrls(markdown: string, rawToData: Map<string, string>): string {
  let out = markdown;
  for (const [raw, data] of rawToData) {
    out = out.split(`](${raw})`).join(`](${data})`);
  }
  return out;
}
