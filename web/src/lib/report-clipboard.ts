import { applySrcMap, collectImgSrcs, collectMarkdownImageRaws, rewriteMarkdownImageUrls } from "@/lib/clipboard-html";
import { renderReportHtml, rewriteRunFileSrc } from "@/lib/markdown";

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

async function fetchImageDataUrl(src: string): Promise<string | undefined> {
  try {
    const res = await fetch(src);
    if (!res.ok) return undefined;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return undefined;
    return blobToDataUrl(blob);
  } catch {
    return undefined;
  }
}

/**
 * Copy the report as text/html (screenshots inlined) plus text/plain markdown.
 * Call from a click so the browser allows clipboard.write.
 */
export async function copyReportToClipboard(markdown: string): Promise<{ images: number }> {
  const html = renderReportHtml(markdown);
  const srcs = collectImgSrcs(html);
  const srcToData = new Map<string, string>();
  await Promise.all(
    srcs.map(async (src) => {
      const data = await fetchImageDataUrl(src);
      if (data) srcToData.set(src, data);
    }),
  );
  const htmlOut = applySrcMap(html, srcToData);
  const rawToData = new Map<string, string>();
  for (const raw of collectMarkdownImageRaws(markdown)) {
    const data = srcToData.get(rewriteRunFileSrc(raw));
    if (data) rawToData.set(raw, data);
  }
  const mdOut = rewriteMarkdownImageUrls(markdown, rawToData);

  const plain = new Blob([mdOut], { type: "text/plain" });
  const rich = new Blob([htmlOut], { type: "text/html" });
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": Promise.resolve(plain),
        "text/html": Promise.resolve(rich),
      }),
    ]);
  } catch {
    await navigator.clipboard.writeText(mdOut);
  }
  return { images: srcToData.size };
}
