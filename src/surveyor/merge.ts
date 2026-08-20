import { Action, Field } from "../schema/page-model.js";
import type {
  Action as ActionT,
  FieldType,
  Page as PageT,
  PageModel,
  PageModelDraft,
  Surface,
  Widget,
} from "../schema/page-model.js";
import { locatorIdentity, type Locator } from "../schema/locator.js";
import { readyKey } from "../schema/refs.js";
import { mintedBase, uniqueMint } from "./ids.js";
import { descriptionRank } from "./describe.js";
import { pageIdFromPath } from "./ready.js";
import { templatizePath } from "./path-template.js";

export function identityKey(
  surfaceId: string,
  by: string,
  value: string,
  name?: string,
): string {
  return `${surfaceId}\0${by}\0${value}\0${name ?? ""}`;
}

export interface Candidate {
  kind: "field" | "action";
  by: "testId" | "name" | "role" | "label";
  value: string;
  name?: string;
  type?: FieldType;
  required?: boolean;
  resolves: boolean;
}

export interface MergeInput {
  pageId: string;
  surfaceId: string;
  surfaceKind: "page" | "dialog";
  surfaceLocator?: Locator;
  candidates: Candidate[];
  leftoverResolves: Record<string, boolean>;
  lastOpensHint?: { actionId: string; actionSurfaceId: string; opens: string; fromPage?: string };
}

export interface MergeResult {
  model: PageModel;
  appended: string[];
  createdSurface: boolean;
}

export function toFieldOrAction(id: string, c: Candidate): Field | Action {
  if (c.kind === "field") {
    return Field.parse({
      id,
      required: c.required ?? false,
      type: c.type ?? "text",
      by: c.by,
      value: c.value,
      ...(c.by === "role" && c.name ? { name: c.name } : {}),
      status: "ok",
    });
  }
  return Action.parse({
    id,
    by: c.by,
    value: c.value,
    ...(c.by === "role" && c.name ? { name: c.name } : {}),
    status: "ok",
  });
}

function isLabelDerived(w: { by: string; name?: string }): boolean {
  return w.by === "label" || (w.by === "role" && Boolean(w.name));
}

function previousLabelOf(w: { by: string; value: string; name?: string }): string {
  return w.by === "label" ? w.value : (w.name ?? w.value);
}

function stripSelfOpens(surface: Surface): void {
  for (const a of surface.actions) {
    if (a.opens === surface.id) delete a.opens;
  }
}

function applyLastOpensHint(model: PageModel, input: MergeInput): void {
  const hint = input.lastOpensHint;
  if (!hint) return;
  if (hint.opens === hint.actionSurfaceId) return;
  for (const page of model.pages) {
    if (hint.fromPage && page.id !== hint.fromPage) continue;
    const surface = page.surfaces.find((s) => s.id === hint.actionSurfaceId);
    if (!surface) continue;
    const opener = surface.actions.find((a) => a.id === hint.actionId);
    if (opener && !opener.opens) {
      opener.opens = hint.opens;
    }
    if (hint.fromPage || opener) return;
  }
}

function applyLeftover(w: Widget, key: string, leftoverResolves: Record<string, boolean>): void {
  // Omitted key = not evaluated (e.g. closed dialog). Leave the widget alone.
  if (!Object.hasOwn(leftoverResolves, key)) return;
  if (leftoverResolves[key]) {
    w.status = "ok";
    delete w.previousLabel;
    return;
  }
  if (isLabelDerived(w)) {
    w.status = "drift";
    w.previousLabel = previousLabelOf(w);
    return;
  }
  w.status = "unresolved";
}

/** usedLocators keys like `createDialog.name` or `page:home.ready`. Extra widgets do not matter. */
export function offlineIdsExist(
  model: PageModel,
  keys: string[],
): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const key of keys) {
    if (!keyExists(model, key)) missing.push(key);
  }
  return { ok: missing.length === 0, missing };
}

function keyExists(model: PageModel, key: string): boolean {
  for (const page of model.pages) {
    if (key === readyKey(page.id)) return true;
  }
  const dot = key.lastIndexOf(".");
  if (dot <= 0 || dot === key.length - 1) return false;
  const surfaceId = key.slice(0, dot);
  const id = key.slice(dot + 1);
  for (const page of model.pages) {
    const surface = page.surfaces.find((s) => s.id === surfaceId);
    if (!surface) continue;
    if (surface.fields.some((f) => f.id === id) || surface.actions.some((a) => a.id === id)) {
      return true;
    }
  }
  return false;
}

function preferStatus(
  a: Widget["status"],
  b: Widget["status"],
): Widget["status"] {
  if (a === "ok" || b === "ok") return "ok";
  if (a === "drift" || b === "drift") return "drift";
  return "unresolved";
}

function mergeWidget(keep: Widget, other: Widget): Widget {
  const next = structuredClone(keep);
  next.status = preferStatus(keep.status, other.status);
  if (next.status === "ok") delete next.previousLabel;
  else if (!next.previousLabel && other.previousLabel) next.previousLabel = other.previousLabel;
  if ("required" in next && "required" in other) {
    next.required = next.required || other.required;
  }
  if ("opens" in next || "opens" in other) {
    const a = keep as ActionT;
    const b = other as ActionT;
    if (!a.opens && b.opens) (next as ActionT).opens = b.opens;
  }
  return next;
}

function mergeSurface(keep: Surface, other: Surface): { surface: Surface; added: number } {
  const surface = structuredClone(keep);
  if (!surface.locator && other.locator) surface.locator = structuredClone(other.locator);
  const byIdentity = new Map<string, Widget>();
  for (const w of surface.fields) byIdentity.set(identityKey(surface.id, w.by, w.value, w.name), w);
  for (const w of surface.actions) byIdentity.set(identityKey(surface.id, w.by, w.value, w.name), w);
  const used = new Set<string>([...surface.fields.map((f) => f.id), ...surface.actions.map((a) => a.id)]);
  let added = 0;

  const take = (w: Widget, kind: "field" | "action") => {
    const key = identityKey(surface.id, w.by, w.value, w.name);
    const found = byIdentity.get(key);
    if (found) {
      const merged = mergeWidget(found, w);
      if (kind === "field") {
        const i = surface.fields.indexOf(found as Field);
        if (i >= 0) surface.fields[i] = merged as Field;
      } else {
        const i = surface.actions.indexOf(found as Action);
        if (i >= 0) surface.actions[i] = merged as Action;
      }
      byIdentity.set(key, merged);
      return;
    }
    const id = uniqueMint(w.id, used);
    const copy = structuredClone(w);
    copy.id = id;
    if (kind === "field") surface.fields.push(copy as Field);
    else surface.actions.push(copy as Action);
    byIdentity.set(key, copy);
    added += 1;
  };

  for (const f of other.fields) take(f, "field");
  for (const a of other.actions) take(a, "action");
  stripSelfOpens(surface);
  return { surface, added };
}

function preferIncomingDescription(keep: PageT, other: PageT): boolean {
  if (!keep.description) return true;
  const incoming = descriptionRank(other.describedBy);
  const held = descriptionRank(keep.describedBy);
  if (incoming !== held) return incoming > held;
  return Boolean(other.describeKey && other.describeKey === keep.describeKey);
}

function applyTemplate(page: PageT): void {
  const t = templatizePath(page.path);
  if (t.params.length === 0) return;
  page.path = t.path;
  page.params = t.params;
}

function rewriteOpens(pages: PageT[], fromId: string, toId: string): void {
  if (fromId === toId) return;
  for (const p of pages) {
    for (const s of p.surfaces) {
      for (const a of s.actions) {
        if (a.opens === fromId) a.opens = toId;
      }
    }
  }
}

/** Collapse `/customers/<token>/migrations` pages onto one `:id1` template. */
export function foldPathTemplates(pages: readonly PageT[]): PageT[] {
  const groups = new Map<string, PageT[]>();
  for (const p of pages) {
    const t = templatizePath(p.path);
    const key = `${p.origin ?? ""}\0${t.path}`;
    const g = groups.get(key) ?? [];
    g.push(p);
    groups.set(key, g);
  }
  const kept: PageT[] = [];
  const used = new Set<string>();
  const idMap = new Map<string, string>();
  for (const group of groups.values()) {
    let winner = structuredClone(group[0]!);
    applyTemplate(winner);
    for (let i = 1; i < group.length; i++) {
      winner = mergePageDef(winner, group[i]!).page;
      applyTemplate(winner);
    }
    const wantBase = pageIdFromPath(winner.path);
    const wantId = used.has(wantBase) && winner.id !== wantBase ? uniqueMint(wantBase, used) : wantBase;
    if (wantId !== winner.id) {
      idMap.set(winner.id, wantId);
      winner.id = wantId;
    }
    used.add(winner.id);
    for (const p of group) {
      if (p.id !== winner.id) idMap.set(p.id, winner.id);
    }
    kept.push(winner);
  }
  for (const [fromId, toId] of idMap) rewriteOpens(kept, fromId, toId);
  return kept;
}

function mergePageDef(keep: PageT, other: PageT): { page: PageT; added: number } {
  const page = structuredClone(keep);
  applyTemplate(page);
  const incomingPage = structuredClone(other);
  applyTemplate(incomingPage);
  if (!page.origin && incomingPage.origin) page.origin = incomingPage.origin;
  if (incomingPage.entry) page.entry = true;
  if (incomingPage.description && preferIncomingDescription(page, incomingPage)) {
    page.description = incomingPage.description;
    if (incomingPage.describeKey) page.describeKey = incomingPage.describeKey;
    if (incomingPage.describedBy) page.describedBy = incomingPage.describedBy;
  }
  const used = new Set(page.surfaces.map((s) => s.id));
  const byKey = new Map<string, number>();
  page.surfaces.forEach((s, i) => {
    byKey.set(`id:${s.id}`, i);
    if (s.locator) byKey.set(`loc:${locatorIdentity(s.locator)}`, i);
  });
  let added = 0;

  for (const incoming of incomingPage.surfaces) {
    const idx =
      byKey.get(`id:${incoming.id}`) ??
      (incoming.locator ? byKey.get(`loc:${locatorIdentity(incoming.locator)}`) : undefined);
    if (idx !== undefined) {
      const merged = mergeSurface(page.surfaces[idx]!, incoming);
      page.surfaces[idx] = merged.surface;
      added += merged.added;
      continue;
    }
    const copy = structuredClone(incoming);
    copy.id = uniqueMint(copy.id, used);
    page.surfaces.push(copy);
    used.add(copy.id);
    added += 1;
  }
  return { page, added };
}

/**
 * Union two maps. Same locator → same id. Extra pages/surfaces/widgets from
 * either side are kept. Used when several monkeys write one map.json.
 * Does not apply leftover/unresolved — that is live inspect only.
 */
export function mergeTrees(base: PageModelDraft, incoming: PageModelDraft): PageModelDraft {
  const pages: PageT[] = structuredClone(base.pages);
  const usedIds = new Set(pages.map((p) => p.id));
  let added = 0;

  const indexById = new Map(pages.map((p, i) => [p.id, i] as const));

  const indexFor = (other: PageT): number | undefined => {
    const otherTpl = templatizePath(other.path).path;
    const exact = pages.findIndex(
      (p) =>
        templatizePath(p.path).path === otherTpl && (p.origin ?? "") === (other.origin ?? ""),
    );
    if (exact >= 0) return exact;
    if (other.origin) {
      const legacy = pages.findIndex(
        (p) => templatizePath(p.path).path === otherTpl && !p.origin,
      );
      if (legacy >= 0) return legacy;
    }
    const byId = indexById.get(other.id);
    if (byId === undefined) return undefined;
    const disk = pages[byId]!;
    if (disk.path === other.path && (disk.origin ?? "") !== (other.origin ?? "")) {
      return undefined;
    }
    return byId;
  };

  for (const other of incoming.pages) {
    const idx = indexFor(other);
    if (idx !== undefined) {
      const merged = mergePageDef(pages[idx]!, other);
      pages[idx] = merged.page;
      added += merged.added;
      continue;
    }
    const copy = structuredClone(other);
    copy.id = uniqueMint(copy.id, usedIds);
    usedIds.add(copy.id);
    pages.push(copy);
    indexById.set(copy.id, pages.length - 1);
    added += 1;
  }

  const folded = foldPathTemplates(pages);
  const generation = Math.max(base.generation, incoming.generation) + added;

  return {
    schemaVersion: 1,
    app: base.app || incoming.app,
    generation,
    pages: folded,
  };
}

export function mergePageModel(model: PageModel, input: MergeInput): MergeResult {
  const srcPage = model.pages.find((p) => p.id === input.pageId);
  if (!srcPage) {
    throw new Error(`unknown page: ${input.pageId}`);
  }

  const existing = srcPage.surfaces.find((s) => s.id === input.surfaceId);
  if (
    !existing &&
    input.surfaceKind !== "page" &&
    !input.candidates.some((c) => c.resolves)
  ) {
    return { model, appended: [], createdSurface: false };
  }

  const next = structuredClone(model);
  const page = next.pages.find((p) => p.id === input.pageId);
  if (!page) {
    throw new Error(`unknown page: ${input.pageId}`);
  }

  let createdSurface = false;
  let surface = page.surfaces.find((s) => s.id === input.surfaceId);
  if (!surface) {
    const created: Surface = {
      id: input.surfaceId,
      kind: input.surfaceKind,
      ...(input.surfaceLocator ? { locator: { ...input.surfaceLocator } } : {}),
      fields: [],
      actions: [],
    };
    page.surfaces.push(created);
    surface = created;
    createdSurface = true;
  }

  applyLastOpensHint(next, input);

  const byIdentity = new Map<string, Widget>();
  for (const w of surface.fields) byIdentity.set(identityKey(input.surfaceId, w.by, w.value, w.name), w);
  for (const w of surface.actions) byIdentity.set(identityKey(input.surfaceId, w.by, w.value, w.name), w);

  const candidateKeys = new Set(
    input.candidates.map((c) => identityKey(input.surfaceId, c.by, c.value, c.name)),
  );
  const used = new Set<string>([
    ...surface.fields.map((f) => f.id),
    ...surface.actions.map((a) => a.id),
  ]);
  const appended: string[] = [];

  for (const c of input.candidates) {
    const key = identityKey(input.surfaceId, c.by, c.value, c.name);
    const found = byIdentity.get(key);
    if (found) {
      found.status = c.resolves ? "ok" : "unresolved";
      if (c.resolves) delete found.previousLabel;
      continue;
    }
    if (!c.resolves) continue;
    const id = uniqueMint(mintedBase(c), used);
    const widget = toFieldOrAction(id, c);
    if (c.kind === "field") {
      surface.fields.push(widget as Field);
    } else {
      surface.actions.push(widget as Action);
    }
    byIdentity.set(key, widget);
    appended.push(id);
  }

  for (const w of [...surface.fields, ...surface.actions]) {
    const key = identityKey(input.surfaceId, w.by, w.value, w.name);
    if (candidateKeys.has(key)) continue;
    applyLeftover(w, key, input.leftoverResolves);
  }
  stripSelfOpens(surface);

  // Status-only edits must not bump generation — logs pin ids to a generation.
  if (createdSurface || appended.length > 0) {
    next.generation += 1;
  }

  return { model: next, appended, createdSurface };
}
