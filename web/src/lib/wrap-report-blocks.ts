/** Fixed box around report screenshots so the page does not jump when they paint. */
export function wrapShotFrames(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => `<span class="shot-frame">${tag}</span>`);
}

const HEADING = /(<h[2-4]\b[^>]*>[\s\S]*?<\/h[2-4]>)/i;
const DIGEST_H3 = /^(start here|chrome|on several pages|pages)$/i;

function headingText(tag: string): string {
  return tag.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Wrap finding titles (h3) and Quality page groups (h4) so print CSS can keep
 * a heading with its screenshot / issues. Tape fences stay outside the card
 * so a long replay can still split.
 */
export function wrapReportPrintBlocks(html: string): string {
  const parts = html.split(HEADING);
  let out = "";
  let open: string | null = null;
  const close = () => {
    if (!open) return;
    out += `</div>`;
    open = null;
  };
  const openCard = (cls: string) => {
    close();
    out += `<div class="${cls}">`;
    open = cls;
  };
  for (const part of parts) {
    if (!part) continue;
    const level = /^<h([2-4])\b/i.exec(part)?.[1];
    if (!level) {
      if (open === "report-card") {
        const pre = part.search(/<pre\b/i);
        if (pre >= 0) {
          out += part.slice(0, pre);
          close();
          out += part.slice(pre);
          continue;
        }
      }
      out += part;
      continue;
    }
    if (level === "2") {
      close();
      out += part;
      continue;
    }
    if (level === "3") {
      if (DIGEST_H3.test(headingText(part))) {
        close();
        out += part;
        continue;
      }
      openCard("report-card");
      out += part;
      continue;
    }
    openCard("report-subcard");
    out += part;
  }
  close();
  return out;
}
