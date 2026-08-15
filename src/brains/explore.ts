import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { formatView } from "../executor/view.js";
import { parseLine } from "../schema/dsl.js";
import type { View } from "../schema/view.js";
import type { ChatMessage } from "./chat.js";
import type { Brain, BrainContext, BrainDecision } from "./types.js";

export const DEFAULT_EXPLORE_CHARTER =
  "General exploratory test: walk legal actions, try empty/invalid input, record runtime errors.";

const ExploreReply = z.object({
  line: z.string().min(1),
  note: z.string().optional(),
});

const RST_FALLBACK = `# Rapid Software Testing — explore pack

- One step at a time. Emit a single DSL line per turn.
- Runtime errors first (uncaught JS, HTTP errors, 404). Note them, then keep walking.
- Only emit DSL that targets mapped ids from \`shown\` and \`actions\`. Never invent ids.
- \`screenshot\` when you need a visual of the current surface.
- \`screenshot ui "brief note"\` to file a UI bug.
- Never click or fill from the content YAML. Content is for reading, not targeting.
- Prefer empty and invalid input on required fields, then a plausible value.
- Reply with JSON only: \`{ "line": "click page.x", "note": "optional" }\`.
`;

export function defaultExploreSkills(): string {
  const path = fileURLToPath(new URL("./skills/rst.md", import.meta.url));
  try {
    return readFileSync(path, "utf8");
  } catch {
    return RST_FALLBACK;
  }
}

/** formatView only — drop Playwright refs and any HTML that leaked into content. */
export function formatViewForBrain(view: View): string {
  return formatView(view)
    .replace(/\s*\[ref=e[^\]]*\]/gi, "")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "");
}

export function isValidDslLine(line: string): boolean {
  try {
    const parsed = parseLine(line);
    return parsed !== null && !("comment" in parsed);
  } catch {
    return false;
  }
}

export function parseExploreReply(raw: string): { line: string; note?: string } | undefined {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/u, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = ExploreReply.parse(JSON.parse(trimmed.slice(start, end + 1)));
    const note = parsed.note?.trim();
    return { line: parsed.line.trim(), ...(note ? { note } : {}) };
  } catch {
    return undefined;
  }
}

export interface ExploreChat {
  (input: { messages: ChatMessage[] }): Promise<string>;
}

export interface ExploreBrain extends Brain {
  getNotes(): string[];
}

export function createExploreBrain(opts: {
  chat: ExploreChat;
  charter: string;
  skills: string;
  startedAt: number;
  minutes?: number;
}): ExploreBrain {
  const notes: string[] = [];

  return {
    name: "explore",
    getNotes: () => [...notes],
    async decide(ctx: BrainContext): Promise<BrainDecision> {
      const remaining =
        opts.minutes === undefined
          ? "unlimited"
          : `${Math.max(0, opts.minutes - (Date.now() - opts.startedAt) / 60_000).toFixed(1)} minutes`;
      const last = ctx.last
        ? ctx.last.ok
          ? "ok"
          : (ctx.last.finding ?? "fail")
        : "none";
      const recent = (ctx.notes ?? notes).slice(-8);
      const charter = ctx.charter ?? opts.charter;
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: [
            "You are an exploratory tester. Reply with JSON only.",
            'Shape: { "line": "<one DSL line>", "note": "optional" }',
            "Legal lines: open <page>, click <surface.id>, fill <surface.id> <value>, expect, screenshot, screenshot ui \"note\".",
            "Use only mapped ids from the view. Never emit HTML.",
            "",
            "Skills:",
            opts.skills,
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `Charter: ${charter}`,
            `Time remaining: ${remaining}`,
            `Steps used: ${ctx.stepsUsed}`,
            `Last result: ${last}`,
            recent.length ? `Recent notes:\n${recent.map((n) => `- ${n}`).join("\n")}` : "Recent notes: (none)",
            "",
            "Current view:",
            formatViewForBrain(ctx.view),
          ].join("\n"),
        },
      ];

      let raw = "";
      try {
        raw = await opts.chat({ messages });
      } catch {
        return { line: "screenshot" };
      }

      const parsed = parseExploreReply(raw);
      if (parsed?.note) notes.push(parsed.note);
      if (!parsed || !isValidDslLine(parsed.line)) {
        return { line: "screenshot", ...(parsed?.note ? { note: parsed.note } : {}) };
      }
      return parsed;
    },
  };
}
