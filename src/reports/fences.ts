import { parseLog, formatLog } from "../schema/dsl.js";
import type { Log } from "../schema/log.js";

export interface ClickmonkeyFence {
  title: string;
  raw: string;
  log: Log;
  /** Screenshot href from the report section above this fence. */
  image?: string;
  /** Loc line after the tape (`ik_` of the bug). */
  idempotencyKey?: string;
  findingId?: string;
  runIds?: string[];
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
    const after = markdown.slice(match.index + match[0].length);
    const nextHead = after.search(/^#{1,6}\s+/m);
    const locWindow = nextHead < 0 ? after : after.slice(0, nextHead);
    const loc =
      /(?: · (\d+)× in (\d+) runs?)? · `(ik_[0-9a-f]+)` · `(fnd_[^`]+)`(.*)$/m.exec(locWindow);
    const runCount = loc?.[2] ? Number(loc[2]) : 1;
    const rest = loc?.[5]
      ? [...loc[5].matchAll(/`([^`]+)`/g)]
          .map((m) => m[1]!)
          .filter((t) => !t.startsWith("ik_") && !t.startsWith("fnd_"))
      : [];
    const runIds = rest.slice(0, Number.isFinite(runCount) && runCount > 0 ? runCount : 1);
    out.push({
      title,
      raw,
      log: parseLog(raw),
      ...(image ? { image } : {}),
      ...(loc?.[3] ? { idempotencyKey: loc[3] } : {}),
      ...(loc?.[4] ? { findingId: loc[4] } : {}),
      ...(runIds.length > 0 ? { runIds } : {}),
    });
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
