import type { Locator as PwLocator } from "playwright";
import { locatorOf } from "../schema/locator.js";
import type { Action, Field, Surface, Widget } from "../schema/page-model.js";
import type { View } from "../schema/view.js";
import { readFieldValidity } from "./field-validity.js";
import { widgetLocator } from "./locators.js";
import type { RunState } from "./run.js";

function isField(w: Widget): w is Field {
  return "type" in w;
}

export type LiveWidgetState = {
  kind: "field" | "action";
  id: string;
  present: boolean;
  visible: boolean;
  enabled: boolean;
  disabled: boolean;
  ariaDisabled: boolean;
  value?: string;
  required?: boolean;
  label?: string;
  opens?: string;
  type?: string;
  placeholder?: string;
  htmlType?: string;
  nativeInvalid?: boolean;
  ariaInvalid?: boolean;
};

export type PageStateSnapshot = {
  page: string;
  surface: string;
  url?: string;
  mode?: string;
  widgets: LiveWidgetState[];
};

type LiveFlags = {
  present: boolean;
  visible: boolean;
  disabled: boolean;
  ariaDisabled: boolean;
  placeholder: string;
  htmlType: string;
  value: string;
};

async function readLiveFlags(loc: PwLocator): Promise<LiveFlags> {
  const n = await loc.count().catch(() => 0);
  if (n === 0) {
    return {
      present: false,
      visible: false,
      disabled: false,
      ariaDisabled: false,
      placeholder: "",
      htmlType: "",
      value: "",
    };
  }
  const el = loc.first();
  const flags = await el
    .evaluate((node) => {
      const typed = node as {
        disabled?: boolean;
        value?: string;
        getAttribute(name: string): string | null;
        getClientRects?: () => { length: number };
        ownerDocument: {
          defaultView: {
            getComputedStyle(el: unknown): { display: string; visibility: string } | null;
          } | null;
        };
      };
      const style = typed.ownerDocument.defaultView?.getComputedStyle(node);
      const visible =
        style?.display !== "none" &&
        style?.visibility !== "hidden" &&
        (typed.getClientRects?.().length ?? 0) > 0;
      return {
        visible: Boolean(visible),
        disabled: Boolean(typed.disabled),
        ariaDisabled: typed.getAttribute("aria-disabled") === "true",
        placeholder: (typed.getAttribute("placeholder") ?? "").trim(),
        htmlType: (typed.getAttribute("type") ?? "").trim().toLowerCase(),
        value: typeof typed.value === "string" ? typed.value : "",
      };
    })
    .catch(() => ({
      visible: false,
      disabled: false,
      ariaDisabled: false,
      placeholder: "",
      htmlType: "",
      value: "",
    }));
  return { present: true, ...flags };
}

function currentSurface(state: RunState): Surface | undefined {
  const surfaceId = state.surfaceStack[state.surfaceStack.length - 1] ?? state.pageId;
  const page = state.model.pages.find((p) => p.id === state.pageId);
  const fromPage = page?.surfaces.find((s) => s.id === surfaceId);
  if (fromPage) return fromPage;
  for (const p of state.model.pages) {
    const s = p.surfaces.find((x) => x.id === surfaceId);
    if (s) return s;
  }
  return undefined;
}

async function snapshotWidget(state: RunState, surface: Surface, widget: Widget): Promise<LiveWidgetState> {
  const loc = widgetLocator(state.page, surface, locatorOf(widget));
  const flags = await readLiveFlags(loc);
  const field = isField(widget);
  const base: LiveWidgetState = {
    kind: field ? "field" : "action",
    id: widget.id,
    present: flags.present,
    visible: flags.visible,
    enabled: flags.present && flags.visible && !flags.disabled && !flags.ariaDisabled,
    disabled: flags.disabled,
    ariaDisabled: flags.ariaDisabled,
  };
  if (field) {
    const f = widget as Field;
    const validity = flags.present ? await readFieldValidity(loc.first(), state.page, f.id) : undefined;
    return {
      ...base,
      value: flags.value,
      required: f.required,
      type: f.type,
      ...(flags.placeholder ? { placeholder: flags.placeholder } : {}),
      ...(flags.htmlType ? { htmlType: flags.htmlType } : {}),
      ...(f.previousLabel ? { label: f.previousLabel } : {}),
      ...(validity
        ? { nativeInvalid: validity.nativeInvalid, ariaInvalid: validity.ariaInvalid }
        : {}),
    };
  }
  const a = widget as Action;
  return {
    ...base,
    ...(a.opens ? { opens: a.opens } : {}),
    ...(a.previousLabel ? { label: a.previousLabel } : {}),
  };
}

/** Mapped widgets on the current surface, including disabled Save. */
export async function snapshotPageState(state: RunState, view?: View): Promise<PageStateSnapshot> {
  const surface = currentSurface(state);
  const widgets: LiveWidgetState[] = [];
  if (surface) {
    for (const w of [...surface.fields, ...surface.actions]) {
      if (w.status !== "ok") continue;
      widgets.push(await snapshotWidget(state, surface, w));
    }
  }
  let url: string | undefined;
  try {
    url = state.page.url();
  } catch {
    url = undefined;
  }
  return {
    page: state.pageId,
    surface: surface?.id ?? "page",
    ...(url ? { url } : {}),
    ...(view?.mode ? { mode: view.mode } : {}),
    widgets,
  };
}

function flagBits(w: LiveWidgetState): string {
  const bits: string[] = [];
  if (!w.present) bits.push("missing");
  else if (!w.visible) bits.push("hidden");
  if (w.disabled) bits.push("disabled");
  if (w.ariaDisabled) bits.push("aria-disabled");
  if (w.present && w.visible && w.enabled) bits.push("enabled");
  if (w.required) bits.push("required");
  if (w.nativeInvalid) bits.push("native-invalid");
  if (w.ariaInvalid) bits.push("aria-invalid");
  if (w.type) bits.push(w.type);
  if (w.htmlType && w.htmlType !== w.type) bits.push(`htmlType=${w.htmlType}`);
  if (w.placeholder) bits.push(`placeholder=${w.placeholder}`);
  return bits.join(", ");
}

/** Host-readable dump. Compact `explore_visit` stays the default; this is on request. */
export function formatPageState(snap: PageStateSnapshot): string {
  const lines = [
    `page: ${snap.page}`,
    ...(snap.mode ? [`mode: ${snap.mode}`] : []),
    `surface: ${snap.surface}`,
    ...(snap.url ? [`url: ${snap.url}`] : []),
    "fields:",
  ];
  const fields = snap.widgets.filter((w) => w.kind === "field");
  const actions = snap.widgets.filter((w) => w.kind === "action");
  if (fields.length === 0) lines.push("  (none)");
  for (const f of fields) {
    const value = f.value !== undefined ? JSON.stringify(f.value) : '""';
    const flags = flagBits(f);
    const label = f.label ? `  ${f.label}` : "";
    lines.push(`  ${f.id}: ${value}${flags ? `  [${flags}]` : ""}${label}`);
  }
  lines.push("actions:");
  if (actions.length === 0) lines.push("  (none)");
  for (const a of actions) {
    const dest = a.opens ? ` → ${a.opens}` : "";
    const flags = flagBits(a);
    const label = a.label ? `  ${a.label}` : "";
    lines.push(`  ${a.id}${dest}${flags ? `  [${flags}]` : ""}${label}`);
  }
  return lines.join("\n");
}
