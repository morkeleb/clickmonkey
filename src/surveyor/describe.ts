import { createHash } from "node:crypto";
import type { ChatMessage } from "../brains/chat.js";
import type { Page } from "../schema/page-model.js";

export const DESCRIPTION_MAX = 200;

export type PageChrome = { title?: string; heading?: string };

function titleCaseSegment(seg: string): string {
  return seg
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function pathTitle(path: string, fallback: string): { title: string; kicker?: string } {
  const segs = path.replace(/\/+$/, "").split("/").filter(Boolean);
  if (segs.length === 0) {
    return { title: fallback === "home" ? "Home" : titleCaseSegment(fallback) };
  }
  if (segs.length === 1) return { title: titleCaseSegment(segs[0]!) };
  return { title: titleCaseSegment(segs[segs.length - 1]!), kicker: titleCaseSegment(segs[0]!) };
}

function humanize(id: string): string {
  return titleCaseSegment(id.replace(/^(button|tab|link|field|input)_/i, ""));
}

function widgetLabel(w: { id: string; name?: string; status?: string }): string {
  return (w.name?.trim() || humanize(w.id)).slice(0, 40);
}

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const key = raw.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

export function clipDescription(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= DESCRIPTION_MAX) return one;
  return `${one.slice(0, DESCRIPTION_MAX - 1)}…`;
}

export function describeKeyOf(page: Page): string {
  const bits: string[] = [page.path];
  for (const s of page.surfaces) {
    bits.push(`${s.kind}:${s.id}`);
    for (const w of [...s.fields, ...s.actions]) {
      if (w.status !== "ok") continue;
      bits.push(`${s.id}.${w.id}`);
    }
  }
  return createHash("sha1").update(bits.sort().join("|")).digest("hex").slice(0, 12);
}

/** Deterministic blurb from path, heading, fields, and dialogs — not the sidenav. */
export function mechanicalDescription(page: Page, chrome?: PageChrome): string {
  const pretty = pathTitle(page.path, page.id);
  const head = chrome?.heading?.trim() || chrome?.title?.trim() || pretty.title;
  const label =
    pretty.kicker && pretty.kicker.toLowerCase() !== head.toLowerCase()
      ? `${pretty.kicker} / ${head}`
      : head;
  const pageSurface = page.surfaces.find((s) => s.kind === "page");
  const dialogs = page.surfaces.filter((s) => s.kind === "dialog").map((s) => humanize(s.id));
  const fields = (pageSurface?.fields ?? []).filter((f) => f.status === "ok");
  const actions = (pageSurface?.actions ?? []).filter((a) => a.status === "ok");
  const fieldNames = unique(fields.map(widgetLabel)).slice(0, 5);
  const parts: string[] = [];
  if (fieldNames.length > 0) parts.push(fieldNames.join(", "));
  if (dialogs.length > 0) parts.push(`dialogs: ${dialogs.slice(0, 4).join(", ")}`);
  if (fieldNames.length === 0 && actions.length > 0) {
    parts.push(`${actions.length} action${actions.length === 1 ? "" : "s"}`);
  }
  const line = parts.length > 0 ? `${label} — ${parts.join(" · ")}` : label;
  return clipDescription(line);
}

/** Write a mechanical blurb when missing or the widget set changed. */
export function applyPageDescription(page: Page, chrome?: PageChrome): boolean {
  const key = describeKeyOf(page);
  if (page.describeKey === key && page.description) return false;
  page.description = mechanicalDescription(page, chrome);
  page.describeKey = key;
  return true;
}

export function pageNotesFromModel(pages: readonly Page[]): Record<string, string> | undefined {
  const notes: Record<string, string> = {};
  for (const p of pages) {
    if (p.description) notes[p.id] = p.description;
  }
  return Object.keys(notes).length > 0 ? notes : undefined;
}

export async function polishPageDescription(
  page: Page,
  chat: (input: { messages: ChatMessage[] }) => Promise<string>,
): Promise<boolean> {
  const facts = mechanicalDescription(page);
  try {
    const raw = await chat({
      messages: [
        {
          role: "system",
          content:
            "You write one-line page blurbs for a QA map. Do not invent widgets or paths. Reply with one line only.",
        },
        {
          role: "user",
          content: [
            `id: ${page.id}`,
            `path: ${page.path}`,
            `facts: ${facts}`,
            "One line, max 160 characters: what this page is for.",
          ].join("\n"),
        },
      ],
    });
    const line = clipDescription(raw.split(/\r?\n/).map((s) => s.trim()).find((s) => s.length > 0) ?? "");
    if (line.length < 8 || line.includes("{") || /^click |^fill |^open /i.test(line)) return false;
    page.description = line;
    return true;
  } catch {
    return false;
  }
}
