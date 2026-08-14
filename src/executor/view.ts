import type { Page } from "playwright";
import type { Locator } from "../schema/locator.js";
import type { Field, PageModel, PageModelDraft, Surface } from "../schema/page-model.js";
import type { ShownAction, ShownField, View } from "../schema/view.js";
import { toPlaywrightLocator } from "./locators.js";

function widgetLocator(w: { by: Locator["by"]; value: string; name?: string }): Locator {
  return w.name === undefined
    ? { by: w.by, value: w.value }
    : { by: w.by, value: w.value, name: w.name };
}

function currentSurface(
  model: PageModel | PageModelDraft,
  pageId: string,
  surfaceId: string,
): Surface | undefined {
  const page = model.pages.find((p) => p.id === pageId);
  const fromPage = page?.surfaces.find((s) => s.id === surfaceId);
  if (fromPage) return fromPage;
  for (const p of model.pages) {
    const s = p.surfaces.find((x) => x.id === surfaceId);
    if (s) return s;
  }
  return undefined;
}

async function liveFieldValue(page: Page, field: Field): Promise<string> {
  const loc = toPlaywrightLocator(page, widgetLocator(field));
  if ((await loc.count()) === 0) return "";
  if (field.type === "password") {
    const raw = await loc.inputValue({ timeout: 0 }).catch(() => "");
    return raw ? "••••" : "";
  }
  if (field.type === "checkbox") {
    const checked = await loc.isChecked({ timeout: 0 }).catch(() => false);
    return checked ? "true" : "false";
  }
  return loc.inputValue({ timeout: 0 }).catch(() => "");
}

export async function buildView(state: {
  page: Page;
  pageId: string;
  surfaceStack: string[];
  model: PageModel | PageModelDraft;
  last?: { step: string; ok: boolean; finding?: string };
}): Promise<View> {
  const stack = state.surfaceStack.length > 0 ? [...state.surfaceStack] : [state.pageId];
  const surfaceId = stack[stack.length - 1] ?? state.pageId;
  const surface = currentSurface(state.model, state.pageId, surfaceId);

  const shown: ShownField[] = [];
  const actions: ShownAction[] = [];

  if (surface) {
    for (const field of surface.fields) {
      if (field.status !== "ok") continue;
      const value = await liveFieldValue(state.page, field);
      shown.push({
        id: field.id,
        value,
        required: field.required,
        type: field.type,
      });
    }
    for (const action of surface.actions) {
      if (action.status !== "ok") continue;
      actions.push(action.opens ? { id: action.id, opens: action.opens } : { id: action.id });
    }
  }

  return {
    page: state.pageId,
    surface: surfaceId,
    stack,
    shown,
    actions,
    ...(state.last ? { last: state.last } : {}),
  };
}

export function formatView(view: View): string {
  const lines: string[] = [
    `page: ${view.page}`,
    `surface: ${view.surface}`,
    `stack: ${view.stack.join(" > ")}`,
    "shown:",
  ];
  for (const field of view.shown) {
    const flags = [field.required ? "required" : undefined, field.type].filter(Boolean).join(", ");
    const rendered = `  ${field.id}: ${JSON.stringify(field.value)}`;
    lines.push(flags ? `${rendered}  [${flags}]` : rendered);
  }
  lines.push("actions:");
  for (const action of view.actions) {
    lines.push(action.opens ? `  ${action.id} → ${action.opens}` : `  ${action.id}`);
  }
  if (view.last) {
    const outcome = view.last.ok ? "ok" : (view.last.finding ?? "fail");
    lines.push(`last: ${view.last.step} → ${outcome}`);
  }
  return `${lines.join("\n")}\n`;
}
