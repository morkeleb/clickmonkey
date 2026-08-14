import { Action, Field } from "../schema/page-model.js";
import type {
  FieldType,
  PageModel,
  Surface,
  Widget,
} from "../schema/page-model.js";
import type { Locator } from "../schema/locator.js";
import { mintedBase, uniqueMint } from "./ids.js";

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
  lastOpensHint?: { actionId: string; actionSurfaceId: string; opens: string };
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

function widgetKey(surfaceId: string, w: { by: string; value: string; name?: string }): string {
  return identityKey(surfaceId, w.by, w.value, w.name);
}

function isLabelDerived(w: { by: string; name?: string }): boolean {
  return w.by === "label" || (w.by === "role" && Boolean(w.name));
}

function previousLabelOf(w: { by: string; value: string; name?: string }): string {
  return w.by === "label" ? w.value : (w.name ?? w.value);
}

function applyLastOpensHint(model: PageModel, input: MergeInput): void {
  const hint = input.lastOpensHint;
  if (!hint) return;
  for (const page of model.pages) {
    const surface = page.surfaces.find((s) => s.id === hint.actionSurfaceId);
    if (!surface) continue;
    const opener = surface.actions.find((a) => a.id === hint.actionId);
    if (opener && !opener.opens) {
      opener.opens = input.surfaceId;
    }
    return;
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
  const ready = /^page:([A-Za-z][A-Za-z0-9_]*)\.ready$/.exec(key);
  if (ready?.[1]) {
    return model.pages.some((p) => p.id === ready[1]);
  }
  const dot = key.lastIndexOf(".");
  if (dot <= 0 || dot === key.length - 1) return false;
  const surfaceId = key.slice(0, dot);
  const id = key.slice(dot + 1);
  for (const page of model.pages) {
    const surface = page.surfaces.find((s) => s.id === surfaceId);
    if (!surface) continue;
    return (
      surface.fields.some((f) => f.id === id) ||
      surface.actions.some((a) => a.id === id)
    );
  }
  return false;
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
  for (const w of surface.fields) byIdentity.set(widgetKey(input.surfaceId, w), w);
  for (const w of surface.actions) byIdentity.set(widgetKey(input.surfaceId, w), w);

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
    const key = widgetKey(input.surfaceId, w);
    if (candidateKeys.has(key)) continue;
    applyLeftover(w, key, input.leftoverResolves);
  }

  // Status-only edits must not bump generation — logs pin ids to a generation.
  if (createdSurface || appended.length > 0) {
    next.generation += 1;
  }

  return { model: next, appended, createdSurface };
}
