import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { formatLiveLine } from "../executor/nav-log.js";
import { formatView } from "../executor/view.js";
import { DslParseError, parseLine } from "../schema/dsl.js";
import type { Step } from "../schema/log.js";
import type { Page } from "../schema/page-model.js";
import { formatExplorePlanItemCoverage, type UiExplorePlan } from "../schema/ui.js";
import type { View } from "../schema/view.js";
import type { ChatMessage } from "./chat.js";
import type { Brain, BrainContext, BrainDecision } from "./types.js";
import { isLeaveAction, matchesSkip, stayActions } from "./unleash.js";
import { detectWalkerMode } from "./walker-mode.js";

export const DEFAULT_EXPLORE_CHARTER =
  "Explore the mapped product with empty/invalid input, claims vs behavior, and interruption to discover runtime errors, data loss, and silent failures.";

const ExploreReply = z.object({
  line: z.string().min(1),
  note: z.string().optional(),
  good: z.string().optional(),
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

The charter is the mission. Do not invent a second one. Runtime errors first.

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

A finding is when an oracle fails and a user would notice. If you cannot say who is harmed, it is \`good\` or a note, not a finding.

## Good

Set \`good\` (one line) when the surface does what its blurb and required fields imply. That is not a finding.
Fence hits and unknown ids are harness, not product bugs.

## Next

Prefer the action that would disprove the \`[>]\` risk or a claim on this surface.
Use page blurbs and Context for risks, never to invent ids.
Empty then invalid then a plausible value on required fields.
Walk mode is form vs list vs nav (see \`Mode:\` on each decide). In form, fill the empties (and submit when the policy is allow) before clicking chrome or hopping. Do not fill one field and leave. Prefer in-page buttons (save, submit, add, edit) over link_* / [nav] / sidebar hops — the form on this surface is the job.
In list, sample each filter, sort, and page control once, then open a row. Do not flip sort or re-click the same combobox.
In nav, follow the \`[>]\` aim; do not treat the surface as a commit form to finish.
If last result was ok and taught nothing, change tactic — different field, page, or oracle.
Stay on the \`[>]\` aim until you can report found, not found, or blocked. Do not start the next item because a hop is interesting.
\`screenshot\` when the surface looks wrong; \`screenshot ui "brief"\` to file it. Not the first walk step, never twice in a row unless the charter is visual.
Layout extras may already be scanned into the quality ledger; \`screenshot ui\` is only for a defect you want as a finding. Do not re-file scanner output as findings. Sight is context, not a command — still emit one legal DSL line. Never invent widget ids from Sight.
\`look.covered\`: note it; do not click expecting a useful result.
Content YAML is for reading claims, not targeting.

## Done

Set \`done: true\` when you can say what you learned about \`[>]\` (found, not found, blocked). One click is not enough.
Do not repeat a recent note.
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

export function exampleExploreLine(view: View, pages?: readonly Page[]): string {
  const empty = view.shown.find((f) => !f.value.trim() || f.value === "••••") ?? view.shown[0];
  if (empty) return `fill ${view.surface}.${empty.id} ""`;
  const stay = stayActions(view, pages)[0];
  if (stay) return `click ${view.surface}.${stay.id}`;
  const action = view.actions[0];
  if (action) return `click ${view.surface}.${action.id}`;
  const page = legalDirectOpenIds(view, pages)[0] ?? view.page;
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

/** Pages `open` can land on without a parent click. Path params are not direct hops. */
export function isDirectOpenPage(page: Pick<Page, "path" | "params">): boolean {
  if ((page.params ?? []).length > 0) return false;
  if (/(^|\/):[A-Za-z_]/.test(page.path)) return false;
  return true;
}

export function pageOpeners(
  pages: readonly Page[],
  targetId: string,
  skip?: readonly string[],
): Array<{ page: string; action: string }> {
  const pageIds = new Set(pages.map((p) => p.id));
  if (!pageIds.has(targetId)) return [];
  const out: Array<{ page: string; action: string }> = [];
  for (const p of pages) {
    if (p.id === targetId) continue;
    for (const s of p.surfaces) {
      for (const a of okWidgets(s.actions)) {
        if (a.opens !== targetId) continue;
        if (isLeaveAction(a) || matchesSkip(a, skip)) continue;
        out.push({ page: p.id, action: a.id });
      }
    }
  }
  return out;
}

/** Longest mapped path prefix of a parameterized page. */
export function pathParentPage(pages: readonly Page[], child: Page): Page | undefined {
  if (isDirectOpenPage(child)) return undefined;
  const childParts = child.path.replace(/\/+$/, "").split("/").filter(Boolean);
  let best: Page | undefined;
  let bestLen = -1;
  for (const p of pages) {
    if (p.id === child.id) continue;
    const parts = p.path.replace(/\/+$/, "").split("/").filter(Boolean);
    if (parts.length >= childParts.length || parts.length <= bestLen) continue;
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const a = parts[i]!;
      const b = childParts[i]!;
      if (a.startsWith(":") || b.startsWith(":")) continue;
      if (a !== b) {
        ok = false;
        break;
      }
    }
    if (ok) {
      best = p;
      bestLen = parts.length;
    }
  }
  return best;
}

/** Direct hops only. Unknown ids and parameterized pages cannot be `open`. */
export function legalDirectOpenIds(view: View, pages?: readonly Page[]): string[] {
  const ids = legalOpenIds(view);
  if (!pages || pages.length === 0) return ids;
  const byId = new Map(pages.map((p) => [p.id, p]));
  return ids.filter((id) => {
    const page = byId.get(id);
    return Boolean(page && isDirectOpenPage(page));
  });
}

function viaBits(page: Page, pages: readonly Page[], skip?: readonly string[]): string[] {
  const via: string[] = [];
  if (isDirectOpenPage(page)) via.push(`open ${page.id}`);
  const clicks = pageOpeners(pages, page.id, skip);
  for (const o of clicks.slice(0, 4)) {
    via.push(`click ${o.action} on ${o.page}`);
  }
  if (clicks.length === 0) {
    const parent = pathParentPage(pages, page);
    if (parent) via.push(`from ${parent.id}`);
  }
  return via;
}

export function usefulExploreNote(raw?: string): string | undefined {
  const t = raw?.trim();
  if (!t) return undefined;
  if (/^optional(?:\s+what worked)?$/i.test(t)) return undefined;
  if (/^what worked$/i.test(t)) return undefined;
  if (/^<oracle>: <saw> → <next>$/i.test(t)) return undefined;
  return t;
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
  opts: {
    stepsUsed: number;
    charter: string;
    rejected?: readonly string[];
    recent?: readonly string[];
    pages?: readonly Page[];
  },
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
            : `no mapped actions to click; try ${exampleExploreLine(view, opts.pages)}`,
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
            : `no mapped fields to ${verb}; try ${exampleExploreLine(view, opts.pages)}`,
      };
    }
    return parsed;
  }

  if (step.kind === "open") {
    const listed = legalOpenIds(view);
    const legal = legalDirectOpenIds(view, opts.pages);
    if (!listed.includes(step.page)) {
      const hops = legal.filter((id) => id !== view.page);
      const hint =
        hops.length > 0
          ? `use open ${hops.slice(0, 3).join(" or open ")}`
          : `do not invent a page id. Try ${exampleExploreLine(view, opts.pages)}`;
      return {
        ok: false,
        error: `open ${step.page} is not in pages:; ${hint}`,
      };
    }
    if (!legal.includes(step.page)) {
      const page = opts.pages?.find((p) => p.id === step.page);
      const via = page ? viaBits(page, opts.pages ?? []) : [];
      const hint =
        via.length > 0
          ? `via ${via.join(" or ")}`
          : `land on a parent page and click through; do not open ${step.page}`;
      return {
        ok: false,
        error: `open ${step.page} is not a direct hop; ${hint}`,
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
    "open <id> only if that exact id is listed under Legal open ids (direct hops). Nested pages: follow via.",
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

export function parseExploreReply(raw: string): { line: string; note?: string; good?: string; done?: boolean } | undefined {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/u, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    const parsed = ExploreReply.parse(JSON.parse(trimmed.slice(start, end + 1)));
    const note = parsed.note?.trim();
    const good = parsed.good?.trim();
    return {
      line: parsed.line.trim(),
      ...(note ? { note } : {}),
      ...(good ? { good } : {}),
      ...(parsed.done ? { done: true } : {}),
    };
  } catch {
    return undefined;
  }
}

export const EXPLORE_PLAN_PROMPT = "ClickMonkey explore plan. Reply with JSON only.";

/** System half of `draftExplorePlan` (includes `EXPLORE_PLAN_PROMPT`). */
export const EXPLORE_PLAN_SYSTEM = [
  EXPLORE_PLAN_PROMPT,
  "You are planning a time-boxed explore session, not walking yet.",
  "The charter is the mission. Do not invent a second one.",
  'JSON: { "goal": "Explore X with Y to discover Z", "items": [ { "title": "<oracle> on <aim>: <what would be wrong>", "page": "optional exact sitemap id" } ] }',
  "2 to 6 items. Title shape: `Empty: required name on create dialog`. Not DSL, not a page name.",
  "Order: writes and required fields, empty/error, claims vs UI, interruption.",
  "Look for is oracles. An item is a risk that an oracle might fail. good behaviour is not an item.",
  "Sitemap cards are every hoppable page. reach is the DAG: open / click / from / dialog. Follow via; do not open nested ids.",
  "page on an item may be any sitemap id (the aim). During the walk, only Legal open ids may be used with open.",
  "Never invent ids.",
].join("\n");

/** Keep the sitemap inside a planner's context. Cut on a card boundary. */
export const PLAN_SITEMAP_MAX = 8000;
/** Architecture context on the plan call. Oracles are not counted against this. */
export const PLAN_CONTEXT_MAX = 2500;
const PLAN_CARD_WIDGETS = 16;

function okWidgets<T extends { status?: string }>(items: readonly T[]): T[] {
  return items.filter((w) => (w.status ?? "ok") === "ok");
}

function fieldBit(field: { id: string; required?: boolean }): string {
  return field.required ? `${field.id}!` : field.id;
}

function actionBit(action: { id: string; opens?: string }): string {
  return action.opens ? `${action.id}→${action.opens}` : action.id;
}

function formatPageCard(
  page: Page,
  pages: readonly Page[],
  skip?: readonly string[],
): string {
  const lines: string[] = [page.description ? `${page.id} — ${page.description}` : page.id];
  const via = viaBits(page, pages, skip);
  lines.push(via.length > 0 ? `  via: ${via.join("; ")}` : `  via: not a direct open (path ${page.path})`);
  const pageSurface = page.surfaces.find((s) => s.kind === "page");
  const fields = okWidgets(pageSurface?.fields ?? [])
    .filter((f) => !matchesSkip(f, skip))
    .slice(0, PLAN_CARD_WIDGETS);
  const actions = okWidgets(pageSurface?.actions ?? [])
    .filter((a) => !isLeaveAction(a) && !matchesSkip(a, skip))
    .slice(0, PLAN_CARD_WIDGETS);
  if (fields.length > 0) lines.push(`  fields: ${fields.map(fieldBit).join(", ")}`);
  if (actions.length > 0) lines.push(`  actions: ${actions.map(actionBit).join(", ")}`);
  const dialogs = page.surfaces.filter((s) => s.kind === "dialog").slice(0, 8);
  if (dialogs.length > 0) {
    const bits = dialogs.map((d) => {
      const inner = [
        ...okWidgets(d.fields)
          .filter((f) => !matchesSkip(f, skip))
          .slice(0, 8)
          .map(fieldBit),
        ...okWidgets(d.actions)
          .filter((a) => !isLeaveAction(a) && !matchesSkip(a, skip))
          .slice(0, 8)
          .map(actionBit),
      ];
      return inner.length > 0 ? `${d.id} (${inner.join(", ")})` : d.id;
    });
    lines.push(`  dialogs: ${bits.join(", ")}`);
  }
  return lines.join("\n");
}

/** Hoppable pages as planning cards: blurb plus ids, no locators. */
export function formatPlanningCards(
  pages: readonly Page[],
  opts?: { ids?: readonly string[]; skip?: readonly string[]; max?: number; heading?: string },
): string {
  const max = opts?.max ?? PLAN_SITEMAP_MAX;
  const byId = new Map(pages.map((p) => [p.id, p]));
  const ordered = opts?.ids
    ? opts.ids.map((id) => byId.get(id)).filter((p): p is Page => Boolean(p))
    : [...pages];
  const header = opts?.heading ?? "sitemap (open only where via says open):";
  const cards: string[] = [header];
  let used = header.length;
  for (const page of ordered) {
    const card = formatPageCard(page, pages, opts?.skip);
    if (used + 1 + card.length > max) {
      cards.push("…");
      break;
    }
    cards.push(card);
    used += 1 + card.length;
  }
  return cards.join("\n");
}

/** Adjacency list: direct opens, click-to-page, path children, dialogs. */
export function formatReachDag(
  pages: readonly Page[],
  opts?: { ids?: readonly string[]; skip?: readonly string[] },
): string {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const ordered = opts?.ids
    ? opts.ids.map((id) => byId.get(id)).filter((p): p is Page => Boolean(p))
    : [...pages];
  const idSet = new Set(ordered.map((p) => p.id));
  const pageIds = new Set(pages.map((p) => p.id));
  const open: string[] = [];
  const click: string[] = [];
  const from: string[] = [];
  const dialog: string[] = [];
  const seenClick = new Set<string>();
  const seenFrom = new Set<string>();
  const seenDialog = new Set<string>();
  for (const page of ordered) {
    if (isDirectOpenPage(page)) open.push(page.id);
    const openers = pageOpeners(pages, page.id, opts?.skip);
    for (const o of openers) {
      if (!idSet.has(o.page) || !idSet.has(page.id)) continue;
      const edge = `${o.page} -${o.action}-> ${page.id}`;
      if (seenClick.has(edge)) continue;
      seenClick.add(edge);
      click.push(edge);
    }
    if (openers.length === 0) {
      const parent = pathParentPage(pages, page);
      if (parent && idSet.has(parent.id) && idSet.has(page.id)) {
        const edge = `${parent.id} -> ${page.id}`;
        if (!seenFrom.has(edge)) {
          seenFrom.add(edge);
          from.push(edge);
        }
      }
    }
    const pageSurface = page.surfaces.find((s) => s.kind === "page");
    for (const a of okWidgets(pageSurface?.actions ?? [])) {
      if (!a.opens || pageIds.has(a.opens)) continue;
      if (isLeaveAction(a) || matchesSkip(a, opts?.skip)) continue;
      const edge = `${page.id} -${a.id}-> ${a.opens}`;
      if (seenDialog.has(edge)) continue;
      seenDialog.add(edge);
      dialog.push(edge);
    }
  }
  const lines = ["reach:"];
  if (open.length > 0) lines.push(`  open: ${open.join(", ")}`);
  if (click.length > 0) lines.push(`  click: ${click.join("; ")}`);
  if (from.length > 0) lines.push(`  from: ${from.join("; ")}`);
  if (dialog.length > 0) lines.push(`  dialog: ${dialog.join("; ")}`);
  return lines.join("\n");
}

function aimAncestorIds(
  pages: readonly Page[],
  aimId: string,
  skip?: readonly string[],
): string[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const ids: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = aimId;
  while (current && !seen.has(current) && ids.length < 4) {
    seen.add(current);
    ids.push(current);
    const page = byId.get(current);
    if (!page || isDirectOpenPage(page)) break;
    const opener: { page: string; action: string } | undefined = pageOpeners(pages, current, skip)[0];
    if (opener) {
      current = opener.page;
      continue;
    }
    current = pathParentPage(pages, page)?.id;
  }
  return ids;
}

function formatAimForWalk(
  plan: UiExplorePlan | undefined,
  pages: readonly Page[] | undefined,
  skip?: readonly string[],
): string {
  const now = plan?.items.find((i) => i.status === "now");
  if (!now?.page || !pages || pages.length === 0) return "";
  const ids = aimAncestorIds(pages, now.page, skip);
  return [
    `Aim [${now.title}]:`,
    formatPlanningCards(pages, { ids, skip, heading: "aim (follow via):" }),
    formatReachDag(pages, { ids, skip }),
  ].join("\n");
}

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
  oracles?: string;
  view: View;
  pages?: readonly Page[];
  skip?: readonly string[];
  logRetry?: (message: string) => void;
}): Promise<UiExplorePlan> {
  const hops = legalOpenIds(opts.view);
  const direct = legalDirectOpenIds(opts.view, opts.pages);
  const log = opts.logRetry ?? defaultLogRetry;
  const sitemap =
    opts.pages && opts.pages.length > 0
      ? formatPlanningCards(opts.pages, { ids: hops, skip: opts.skip })
      : "";
  const reach =
    opts.pages && opts.pages.length > 0 ? formatReachDag(opts.pages, { ids: hops, skip: opts.skip }) : "";
  const architecture = opts.skills.trim().slice(0, PLAN_CONTEXT_MAX);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: EXPLORE_PLAN_SYSTEM,
    },
    {
      role: "user",
      content: [
        `Charter: ${opts.charter}`,
        opts.oracles?.trim() ? `Look for:\n${opts.oracles.trim()}` : "",
        architecture
          ? `Context:\n${architecture}`
          : "No architecture file. Plan only from sitemap, charter, and oracles.",
        `Legal open ids (direct hops only): ${direct.join(", ") || "(none)"}`,
        sitemap,
        reach,
        "Current view (start here):",
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
    const parsed = parseExplorePlanReply(raw, hops);
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
        'That was not a valid plan JSON. Reply with { "goal": "...", "items": [ { "title": "...", "page": "<id from the sitemap>" } ] }.',
    });
  }
  throw new ExploreError(`explore could not draft a plan: ${lastError}`);
}

export interface ExploreBrain extends Brain {
  getNotes(): string[];
  getGoods(): string[];
}

export function createExploreBrain(opts: {
  chat: ExploreChat;
  charter: string;
  skills: string;
  oracles?: string;
  startedAt: number;
  minutes?: number;
  pages?: readonly Page[];
  skip?: readonly string[];
  logRetry?: (message: string) => void;
}): ExploreBrain {
  const notes: string[] = [];
  const goods: string[] = [];
  const rejected = new Set<string>();
  const logRetry = opts.logRetry ?? defaultLogRetry;

  return {
    name: "explore",
    getNotes: () => [...notes],
    getGoods: () => [...goods],
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
      const pages = ctx.pages ?? opts.pages;
      const example = exampleExploreLine(ctx.view, pages);
      const opens = legalDirectOpenIds(ctx.view, pages);
      const rejectedLines = [...rejected];
      const walkerMode = detectWalkerMode(ctx).name;
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: [
            "You are an exploratory tester. Reply with JSON only.",
            "The charter is the mission. Do not invent a second one.",
            `Mode: ${walkerMode}`,
            'Shape: { "line": "<one DSL line>", "note": "<oracle>: <saw> → <next>", "done": false }',
            "Follow the plan item marked [>]. Stay on that aim until you can report found, not found, or blocked. Do not hop away because another page looks interesting.",
            "Set done: true only when you can report on [>]. One click is not enough.",
            "note must add something Recent notes do not already say. Use Last result. Aim cards show via for nested pages.",
            "Set good when the surface does what its blurb and required fields imply. Fence and unknown id are not product bugs.",
            'Legal lines: open <pageId>, click <surface.id>, fill <surface.id> <value>, expect, screenshot, screenshot ui "note".',
            "click/fill must be surface.id with a dot. Example: click page.x. Never click x.",
            "open <id> only if that exact id is listed under Legal open ids (direct hops). Nested pages: follow via. Never invent a page id from the charter or skills.",
            "If pages: is empty, do not emit open — click a mapped action.",
            "Do not click Close-tab chrome (button_close_*). Do not re-open a page you just left.",
            walkerMode === "form"
              ? "Prefer shown fields and in-page buttons (save, submit, add, edit) over link_* / [nav] / sidebar hops. Chrome is abundant; finish the form or local button before opening another page."
              : walkerMode === "list"
                ? "Sample each filter, sort, and page control once, then open a row. Do not flip sort or re-open the same combobox. This is not a commit form."
                : "Prefer mapped actions that serve the [>] aim. This is not a commit form.",
            "Use only mapped ids from shown and actions. Never emit HTML.",
            visual
              ? "screenshot is legal when you choose it."
              : "Do not emit screenshot as the first walk step or twice in a row.",
            opts.oracles?.trim() ? `Look for:\n${opts.oracles.trim()}` : "",
            opts.skills.trim()
              ? `Context:\n${opts.skills.trim()}`
              : "No architecture file. Use sitemap, charter, oracles, and the current view.",
          ]
            .filter(Boolean)
            .join("\n"),
        },
        {
          role: "user",
          content: [
            `Charter: ${charter}`,
            `Time remaining: ${remaining}`,
            `Steps used: ${ctx.stepsUsed}`,
            `Last result: ${last}`,
            ctx.plan ? `Plan:\n${formatExplorePlan(ctx.plan)}` : "",
            formatAimForWalk(ctx.plan, pages, opts.skip),
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
            "Choose a step that uses Last result and Recent notes against the [>] risk. Stay on the aim path. Do not repeat a recent note.",
            "",
            "Current view:",
            formatViewForBrain(ctx.view),
            ctx.sight?.trim() ? `Sight: ${ctx.sight.trim()}` : "",
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
          pages,
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

        const note = usefulExploreNote(parsed.note);
        const good = usefulExploreNote(parsed.good);
        if (note) notes.push(note);
        if (good) goods.push(good);
        return {
          line: parsed.line,
          mode: walkerMode,
          ...(note ? { note } : {}),
          ...(good ? { good } : {}),
          ...(parsed.done ? { done: true } : {}),
        };
      }

      throw new ExploreError(
        `explore did not get a legal DSL line after ${attempts} attempts: ${lastError}`,
      );
    },
  };
}
