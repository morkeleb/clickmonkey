import DOMPurify from "dompurify";
import { marked } from "marked";

/** Point report screenshots at the CLI file server when they look like run paths. */
export function rewriteRunFileSrc(src: string): string {
  const trimmed = src.trim();
  if (!trimmed) return trimmed;
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/files/")) return trimmed;

  const normalized = trimmed.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
  const withoutUp = normalized.replace(/^(?:\.\.\/)+/, "");
  const match = withoutUp.match(/(?:^|\/)(runs\/[^?#]*)/);
  if (match?.[1]) return `/files/${match[1]}`;
  return trimmed;
}

function rewriteHtmlImages(html: string): string {
  return html.replace(/<img\b([^>]*?)\bsrc=(["'])(.*?)\2/gi, (_all, pre: string, q: string, src: string) => {
    return `<img${pre}src=${q}${rewriteRunFileSrc(src)}${q}`;
  });
}

export function renderReportHtml(markdown: string): string {
  const raw = marked.parse(markdown, { async: false }) as string;
  const withFiles = rewriteHtmlImages(raw);
  return DOMPurify.sanitize(withFiles, { USE_PROFILES: { html: true } });
}
