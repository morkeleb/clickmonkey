import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { formatLiveLine } from "../executor/nav-log.js";
import { formatView } from "../executor/view.js";
import { DslParseError, parseLine } from "../schema/dsl.js";
import type { Step } from "../schema/log.js";
import { formatExplorePlanItemCoverage, type UiExplorePlan } from "../schema/ui.js";
import type { View } from "../schema/view.js";
import type { ChatMessage } from "./chat.js";
import type { Brain, BrainContext, BrainDecision } from "./types.js";

export const DEFAULT_EXPLORE_CHARTER =
  "Explore the mapped product with empty/invalid input, claims vs behavior, and interruption to discover runtime errors, data loss, and silent failures.";

const ExploreReply = z.object({
  line: z.string().min(1),
  note: z.string().optional(),
  done: z.boolean().optional(),
});

const PlanReply = z.object({
  goal: z.string().min(1),
  items: z
    .array(
      z.object({
        title: z.string().min(1),
        page: z.string().min(1).optional(),
      }),
    )
    .min(2)
    .max(8),
});

const RST_FALLBACK = `# Explore pack

Each step should teach the next one. Runtime errors first.

## Oracles

Name one in \`note\` (\`<oracle>: <saw> → <next>\`):

- Runtime: uncaught JS, HTTP, 404, testability
- Claim: label, button, or copy vs what happened
- Purpose: can the user finish the job on this surface?
- Consistency: same control, different behavior
- Empty: 0 items, required blank, very long text
- Interruption: leave mid-flow, come back
- Affordance: looks clickable but isn't, or the reverse
- Visual: overlap, fonts that don't match \`look.fonts\`, covered widgets

## Next

Prefer the action that would disprove the \`[>]\` risk or a claim on this surface.
Use page blurbs and Context for risks, never to invent ids.
Empty then invalid then a plausible value on required fields.
If last result was ok and taught nothing, change tactic — different field, page, or oracle.
\`screenshot\` when the surface looks wrong; \`screenshot ui "brief"\` to file it. Not the first walk step, never twice in a row unless the charter is visual.
\`look.covered\`: note it; do not click expecting a useful result.
Content YAML is for reading claims, not targeting.

## Done

Set \`done: true\` when you can say what you learned about \`[>]\` (found, not found, blocked). One click is not enough.
Do not repeat a recent note. Positive observations belong in notes too.
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

export class ExploreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExploreError";
  }
}

export const EXPLORE_PROBE = "ClickMonkey explore probe. Reply with the single word pong.";

export interface ExploreChat {
  (input: { messages: ChatMessage[] }): Promise<string>;
}

function errorText(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = err.cause instanceof Error ? err.cause.message : undefined;
  return cause ? `${err.message} (${cause})` : err.message;
}

/** First attempt plus this many repair turns. */
export const EXPLORE_DECIDE_RETRIES = 3;

export function isValidDslLine(line: string): boolean {
  try {
    const parsed = parseLine(line);
    return parsed !== null && !("comment" in parsed);
  } catch {
    return false;
  }
}

export function isScreenshotLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  try {
    const parsed = parseLine(trimmed);
    return parsed !== null && !("comment" in parsed) && parsed.kind === "screenshot";
  } catch {
    return /^screenshot(?:\s|$)/.test(trimmed);
  }
}

export function isVisualCharter(charter: string): boolean {
  return /\b(visual|screenshot|look|layout|overlap)\b/i.test(charter);
}

export function exampleExploreLine(view: View): string {
  const action = view.actions[0];
  if (action) return `click ${view.surface}.${action.id}`;
  const field = view.shown[0];
  if (field) return `fill ${view.surface}.${field.id} ""`;
  const page = legalOpenIds(view)[0] ?? view.page;
  return `open ${page}`;
}

/** Current page plus hoppable `pages:`. Invented ids are never in this list. */
export function legalOpenIds(view: View): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of [view.page, ...(view.pages ?? [])]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function isBrainMissFinding(kind: string | undefined): boolean {
  return kind === "unknownId" || kind === "unresolvedId";
}

/** Persist minted a new product folder, not a dedup or a quiet brain miss. */
export function isNewProductFinding(opts: {
  finding?: { id: string; kind: string };
  findingCreated?: boolean;
  currentFindingIds?: readonly string[];
}): boolean {
  if (!opts.finding || !opts.findingCreated) return false;
  if (isBrainMissFinding(opts.finding.kind)) return false;
  return !opts.currentFindingIds?.includes(opts.finding.id);
}

/** True if `line` would continue a 2-step (A B A) or 3-step (A B C A) ping-pong. */
export function wouldRepeatCycle(recent: readonly string[], line: string): boolean {
  const n = recent.length;
  if (n >= 2 && recent[n - 2] === line) return true;
  if (n >= 3 && recent[n - 3] === line) return true;
  return false;
}

function dslError(line: string, err: unknown): string {
  if (err instanceof DslParseError) {
    const core = err.message.replace(/^line \d+: /, "");
    if (/expected surface\.id/.test(core)) return `expected surface.id, got ${line}`;
    return core;
  }
  return errorText(err);
}

function parseExploreStep(line: string): { ok: true; step: Step } | { ok: false; error: string } {
  try {
    const parsed = parseLine(line);
    if (parsed === null || "comment" in parsed) {
      return { ok: false, error: `not a DSL step: ${JSON.stringify(line)}` };
    }
    return { ok: true, step: parsed };
  } catch (err) {
    return { ok: false, error: dslError(line, err) };
  }
}

/** parseLine plus cheap view-id / screenshot-policy checks. */
export function checkExploreLine(
  line: string,
  view: View,
  opts: { stepsUsed: number; charter: string; rejected?: readonly string[]; recent?: readonly string[] },
): { ok: true; step: Step } | { ok: false; error: string; ban?: boolean } {
  const trimmed = line.trim();
  if (opts.rejected?.includes(trimmed)) {
    return { ok: false, error: `${trimmed} already failed; do not retry it` };
  }
  if (wouldRepeatCycle(opts.recent ?? [], trimmed)) {
    return {
      ok: false,
      ban: false,
      error: `${trimmed} repeats a hop/close cycle; pick a different page or action`,
    };
  }
  const parsed = parseExploreStep(trimmed);
  if (!parsed.ok) return parsed;
  const step = parsed.step;
  const visual = isVisualCharter(opts.charter);
  const lastLine = view.last?.step ?? "";

  if (step.kind === "screenshot") {
    if (!visual && opts.stepsUsed === 0) {
      return { ok: false, error: "screenshot is not legal as the first walk step; pick a click, fill, or open" };
    }
    if (!visual && isScreenshotLine(lastLine)) {
      return {
        ok: false,
        error: `screenshot is not legal when the last step was already a screenshot (${lastLine})`,
      };
    }
    return parsed;
  }

  if (step.kind === "click") {
    const ref = `${step.surface}.${step.id}`;
    const legal = view.actions.map((a) => `${view.surface}.${a.id}`);
    if (!legal.includes(ref)) {
      return {
        ok: false,
        error:
          legal.length > 0
            ? `click ${ref} is not a mapped action; use ${legal.map((id) => `click ${id}`).slice(0, 3).join(" or ")}`
            : `no mapped actions to click; try ${exampleExploreLine(view)}`,
      };
    }
    return parsed;
  }

  if (step.kind === "fill" || step.kind === "expectInvalid") {
    const ref = `${step.surface}.${step.id}`;
    const legal = view.shown.map((f) => `${view.surface}.${f.id}`);
    if (!legal.includes(ref)) {
      const verb = step.kind === "fill" ? "fill" : "expect";
      return {
        ok: false,
        error:
          legal.length > 0
            ? `${verb} ${ref} is not a mapped field; use ${legal.slice(0, 3).join(" or ")}`
            : `no mapped fields to ${verb}; try ${exampleExploreLine(view)}`,
      };
    }
    return parsed;
  }

  if (step.kind === "open") {
    const legal = legalOpenIds(view);
    if (!legal.includes(step.page)) {
      const hops = (view.pages ?? []).filter((id) => id !== view.page);
      const hint =
        hops.length > 0
          ? `use open ${hops.slice(0, 3).join(" or open ")}`
          : `do not invent a page id. Try ${exampleExploreLine(view)}`;
      return {
        ok: false,
        error: `open ${step.page} is not in pages:; ${hint}`,
      };
    }
    return parsed;
  }

  return parsed;
}

function repairUserMessage(error: string, example: string): string {
  return [
    `That reply is not a legal step: ${error}`,
    `Reply with JSON only: { "line": "${example}" }`,
    "click/fill must be surface.id with a dot (click page.x), never click x.",
    "open <id> only if that exact id is listed under pages:. Never invent a page id.",
  ].join("\n");
}

function defaultLogRetry(message: string): void {
  process.stderr.write(`${formatLiveLine(message)}\n`);
}

/** Ping the model before opening a browser. Throws ExploreError if it cannot answer. */
export async function probeExploreChat(opts: {
  chat: ExploreChat;
  baseUrl: string;
  model: string;
}): Promise<void> {
  let reply: string;
  try {
    reply = await opts.chat({
      messages: [{ role: "user", content: EXPLORE_PROBE }],
    });
  } catch (err) {
    throw new ExploreError(
      `explore cannot reach the language model at ${opts.baseUrl} (model ${opts.model}): ${errorText(err)}`,
    );
  }
  if (!reply.trim()) {
    throw new ExploreError(
      `explore reached ${opts.baseUrl} but model ${opts.model} returned an empty reply`,
    );
  }
}

export function parseExploreReply(raw: string): { line: string; note?: string; done?: boolean } | undefined {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/u, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = ExploreReply.parse(JSON.parse(trimmed.slice(start, end + 1)));
    const note = parsed.note?.trim();
    return {
      line: parsed.line.trim(),
      ...(note ? { note } : {}),
      ...(parsed.done ? { done: true } : {}),
    };
  } catch {
    return undefined;
  }
}

export const EXPLORE_PLAN_PROMPT = "ClickMonkey explore plan. Reply with JSON only.";

function clipText(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return `${one.slice(0, max - 1)}…`;
}

export function formatExplorePlan(plan: UiExplorePlan): string {
  return [
    `Goal: ${plan.goal}`,
    ...plan.items.map((it, i) => {
      const mark = it.status === "done" ? "x" : it.status === "now" ? ">" : it.status === "skipped" ? "-" : " ";
      const page = it.page ? ` [page: ${it.page}]` : "";
      return `${i + 1}. [${mark}] ${it.title}${page} — ${formatExplorePlanItemCoverage(it)}`;
    }),
  ].join("\n");
}

export function completeCurrentPlanItem(plan: UiExplorePlan, status: "done" | "skipped"): UiExplorePlan {
  const items = plan.items.map((it) => (it.status === "now" ? { ...it, status } : { ...it }));
  const next = items.find((it) => it.status === "pending");
  if (next) next.status = "now";
  return { goal: plan.goal, items };
}

export function recordPlanStep(plan: UiExplorePlan, opts?: { findingId?: string }): UiExplorePlan {
  const items = plan.items.map((it) => {
    if (it.status !== "now") return { ...it };
    const findingIds = [...(it.findingIds ?? [])];
    if (opts?.findingId && !findingIds.includes(opts.findingId)) findingIds.push(opts.findingId);
    return { ...it, stepCount: (it.stepCount ?? 0) + 1, findingIds };
  });
  return { goal: plan.goal, items };
}

export function parseExplorePlanReply(raw: string, legalPages: readonly string[]): UiExplorePlan | undefined {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/u, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = PlanReply.parse(JSON.parse(trimmed.slice(start, end + 1)));
    const legal = new Set(legalPages);
    const items = parsed.items.slice(0, 6).map((it, idx) => {
      const page = it.page?.trim();
      return {
        id: String(idx + 1),
        title: clipText(it.title, 120),
        ...(page && legal.has(page) ? { page } : {}),
        status: (idx === 0 ? "now" : "pending") as "now" | "pending",
        stepCount: 0,
        findingIds: [],
      };
    });
    if (items.length < 2) return undefined;
    return { goal: clipText(parsed.goal, 200), items };
  } catch {
    return undefined;
  }
}

export async function draftExplorePlan(opts: {
  chat: ExploreChat;
  charter: string;
  skills: string;
  view: View;
  logRetry?: (message: string) => void;
}): Promise<UiExplorePlan> {
  const legal = legalOpenIds(opts.view);
  const log = opts.logRetry ?? defaultLogRetry;
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        EXPLORE_PLAN_PROMPT,
        "You are planning a time-boxed explore session, not walking yet.",
        'JSON: { "goal": "Explore X with Y to discover Z", "items": [ { "title": "risk or question", "page": "optional exact pages: id" } ] }',
        "2 to 6 items. Order: money/writes/permissions, empty/error states, claims vs UI, interruption.",
        "Titles are risks, not DSL and not page names. Do not emit click/fill/open lines.",
        "page must be copied exactly from Legal open ids. Omit page if unsure. Never invent ids.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Charter: ${opts.charter}`,
        opts.skills.trim() ? `Context:\n${opts.skills.trim().slice(0, 2500)}` : "",
        `Legal open ids: ${legal.join(", ") || "(none)"}`,
        "",
        "Current view:",
        formatViewForBrain(opts.view),
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  let lastError = "no plan";
  for (let attempt = 0; attempt < 3; attempt++) {
    let raw: string;
    try {
      raw = await opts.chat({ messages });
    } catch (err) {
      throw new ExploreError(`explore could not draft a plan: ${errorText(err)}`);
    }
    const parsed = parseExplorePlanReply(raw, legal);
    if (parsed) {
      log(`explore plan: ${parsed.items.length} items — ${parsed.goal}`);
      return parsed;
    }
    lastError = `expected JSON plan, got ${JSON.stringify(raw.slice(0, 200))}`;
    log(`brain retry: ${lastError}`);
    messages.push({ role: "assistant", content: raw });
    messages.push({
      role: "user",
      content:
        'That was not a valid plan JSON. Reply with { "goal": "...", "items": [ { "title": "...", "page": "<id from Legal open ids>" } ] }.',
    });
  }
  throw new ExploreError(`explore could not draft a plan: ${lastError}`);
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
  logRetry?: (message: string) => void;
}): ExploreBrain {
  const notes: string[] = [];
  const rejected = new Set<string>();
  const logRetry = opts.logRetry ?? defaultLogRetry;

  return {
    name: "explore",
    getNotes: () => [...notes],
    async decide(ctx: BrainContext): Promise<BrainDecision> {
      if (isBrainMissFinding(ctx.last?.finding) && ctx.view.last?.step) {
        rejected.add(ctx.view.last.step.trim());
      }
      const remaining =
        opts.minutes === undefined
          ? "unlimited"
          : `${Math.max(0, opts.minutes - (Date.now() - opts.startedAt) / 60_000).toFixed(1)} minutes`;
      const last = ctx.last
        ? ctx.last.ok
          ? "ok"
          : (ctx.last.finding ?? "fail")
        : "none";
      const lastLine = ctx.view.last?.step ?? "";
      const lastWasScreenshot = isScreenshotLine(lastLine);
      const recentNotes = (ctx.notes ?? notes).slice(-8);
      const recentSteps = ctx.recent ?? [];
      const charter = ctx.charter ?? opts.charter;
      const visual = isVisualCharter(charter);
      const example = exampleExploreLine(ctx.view);
      const opens = legalOpenIds(ctx.view);
      const rejectedLines = [...rejected];
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: [
            "You are an exploratory tester. Reply with JSON only.",
            'Shape: { "line": "<one DSL line>", "note": "<oracle>: <saw> → <next>", "done": false }',
            "Follow the plan item marked [>]. Set done: true only when you can report on that risk (found, not found, or blocked). One click is not enough.",
            "note must add something Recent notes do not already say. Use Last result.",
            'Legal lines: open <pageId>, click <surface.id>, fill <surface.id> <value>, expect, screenshot, screenshot ui "note".',
            "click/fill must be surface.id with a dot. Example: click page.x. Never click x.",
            "open <id> only if that exact id is listed under pages:. Never invent a page id from the charter or skills.",
            "If pages: is empty, do not emit open — click a mapped action.",
            "Do not click Close-tab chrome (button_close_*). Do not re-open a page you just left.",
            "Use only mapped ids from shown and actions. Never emit HTML.",
            visual
              ? "screenshot is legal when you choose it."
              : "Do not emit screenshot as the first walk step or twice in a row.",
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
            ctx.plan ? `Plan:\n${formatExplorePlan(ctx.plan)}` : "",
            opens.length ? `Legal open ids: ${opens.join(", ")}` : "Legal open ids: (none) — do not emit open.",
            rejectedLines.length
              ? `Do not retry:\n${rejectedLines.map((l) => `- ${l}`).join("\n")}`
              : "",
            !visual && ctx.stepsUsed === 0
              ? "This is the first walk step. Do not emit screenshot."
              : "",
            !visual && lastWasScreenshot
              ? `The last step was already a screenshot (${lastLine}). Do not emit screenshot — pick a click, fill, open, or expect.`
              : "",
            recentSteps.length > 0
              ? `Recent steps: ${recentSteps.slice(-6).join(" → ")}. Do not ping-pong (open X, leave, open X).`
              : "",
            recentNotes.length ? `Recent notes:\n${recentNotes.map((n) => `- ${n}`).join("\n")}` : "Recent notes: (none)",
            "Choose a step that uses Last result and Recent notes against the [>] risk. Do not repeat a recent note.",
            "",
            "Current view:",
            formatViewForBrain(ctx.view),
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ];

      const attempts = EXPLORE_DECIDE_RETRIES + 1;
      let lastError = "no reply";
      for (let attempt = 0; attempt < attempts; attempt++) {
        let raw: string;
        try {
          raw = await opts.chat({ messages });
        } catch (err) {
          lastError = `chat failed: ${errorText(err)}`;
          logRetry(`brain retry: ${lastError}`);
          messages.push({ role: "user", content: repairUserMessage(lastError, example) });
          continue;
        }

        const parsed = parseExploreReply(raw);
        if (!parsed) {
          lastError = `expected JSON { "line": "<DSL>" }, got ${JSON.stringify(raw.slice(0, 240))}`;
          logRetry(`brain retry: ${lastError}`);
          messages.push({ role: "assistant", content: raw });
          messages.push({ role: "user", content: repairUserMessage(lastError, example) });
          continue;
        }

        const check = checkExploreLine(parsed.line, ctx.view, {
          stepsUsed: ctx.stepsUsed,
          charter,
          rejected: [...rejected],
          recent: recentSteps,
        });
        if (!check.ok) {
          lastError = check.error;
          const failed = parseExploreStep(parsed.line);
          if (check.ban !== false && failed.ok && failed.step.kind === "open") {
            rejected.add(parsed.line.trim());
          }
          logRetry(`brain retry: ${lastError}`);
          messages.push({ role: "assistant", content: raw });
          messages.push({ role: "user", content: repairUserMessage(lastError, example) });
          continue;
        }

        if (parsed.note) notes.push(parsed.note);
        return parsed;
      }

      throw new ExploreError(
        `explore did not get a legal DSL line after ${attempts} attempts: ${lastError}`,
      );
    },
  };
}
