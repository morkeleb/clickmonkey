import { parseLog, formatLog } from "../schema/dsl.js";
import type { Log } from "../schema/log.js";

export interface ClickmonkeyFence {
  title: string;
  raw: string;
  log: Log;
  /** Screenshot href from the report section above this fence. */
  image?: string;
}

const FENCE = /```clickmonkey[ \t]*\r?\n([\s\S]*?)```/gi;

/** Heading immediately above a fence becomes the case title. */
export function extractClickmonkeyFences(markdown: string): ClickmonkeyFence[] {
  const out: ClickmonkeyFence[] = [];
  const re = new RegExp(FENCE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown))) {
    const raw = (match[1] ?? "").replace(/^(?:\r?\n)+|(?:\r?\n)+$/g, "");
    if (!raw.trim()) continue;
    const before = markdown.slice(0, match.index);
    const heads = [...before.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)];
    const heading = heads[heads.length - 1]?.[1];
    const title = heading?.trim() || parseLog(raw).bug || `case ${out.length + 1}`;
    const sectionStart = heads.length ? before.lastIndexOf(heads[heads.length - 1]![0]!) : 0;
    const section = before.slice(Math.max(0, sectionStart));
    const images = [...section.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)];
    const image = images[images.length - 1]?.[1]?.trim();
    out.push({ title, raw, log: parseLog(raw), ...(image ? { image } : {}) });
  }
  return out;
}

export function wrapClickmonkeyFence(log: Log): string {
  const body = formatLog(log).trimEnd();
  return `\`\`\`clickmonkey\n${body}\n\`\`\``;
}

export function isFindingsReport(text: string): boolean {
  return /```clickmonkey\b/i.test(text) || /^# Findings report\s*$/m.test(text);
}
