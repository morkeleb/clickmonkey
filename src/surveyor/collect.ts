import type { Locator as PwLocator, Page } from "playwright";
import type { FieldType } from "../schema/page-model.js";
import { identityKey, type Candidate } from "./merge.js";

const FIELD_SELECTOR = 'input, select, textarea, [contenteditable="true"]';
const ACTION_SELECTOR =
  'button, a[href], [role="button"], input[type="submit"], input[type="button"]';

export interface CollectOptions {
  excludeVisibleDialogs?: boolean;
}

type BrowserEl = {
  tagName: string;
  id: string;
  innerText: string;
  nodeType?: number;
  textContent?: string | null;
  childNodes?: ArrayLike<BrowserEl>;
  type?: string;
  required?: boolean;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  closest(sel: string): BrowserEl | null;
};

type WidgetRead = {
  testId: string;
  nameAttr: string;
  role: string;
  accName: string;
  labelText: string;
  required: boolean;
  tag: string;
  inputType: string;
  contentEditable: boolean;
  insideDialog: boolean;
};

/** Browser-side read. Must stay closure-free for page.evaluate. */
function readWidget(el: BrowserEl): WidgetRead {
  const g = globalThis as unknown as {
    document: {
      getElementById(id: string): BrowserEl | null;
      querySelector(sel: string): BrowserEl | null;
    };
    CSS?: { escape(s: string): string };
  };
  const tag = el.tagName.toLowerCase();
  const inputType = tag === "input" ? el.type || "text" : "";

  const roleAttr = el.getAttribute("role");
  let role = roleAttr && roleAttr.trim() ? roleAttr.trim() : "";
  if (!role) {
    if (tag === "button") role = "button";
    else if (tag === "a" && el.hasAttribute("href")) role = "link";
    else if (tag === "dialog") role = "dialog";
    else if (tag === "select") role = "combobox";
    else if (tag === "textarea") role = "textbox";
    else if (tag === "input") {
      if (["text", "email", "password", "search", "tel", "url"].includes(inputType)) {
        role = "textbox";
      } else if (inputType === "checkbox") role = "checkbox";
      else if (inputType === "radio") role = "radio";
      else if (inputType === "number") role = "spinbutton";
      else if (inputType === "submit" || inputType === "button") role = "button";
    }
  }

  let accName = "";
  const aria = el.getAttribute("aria-label");
  if (aria && aria.trim()) {
    accName = aria.trim().slice(0, 80);
  } else {
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => g.document.getElementById(id)?.innerText ?? "")
        .join(" ")
        .trim();
      if (text) accName = text.slice(0, 80);
    }
  }
  if (!accName) {
    const parts: string[] = [];
    const stack: BrowserEl[] = [el];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) continue;
      if (node.nodeType === 3) {
        const t = (node.textContent ?? "").replace(/\s+/g, " ").trim();
        if (t) parts.push(t);
        continue;
      }
      if (node.getAttribute && node.getAttribute("aria-hidden") === "true") continue;
      const kids = node.childNodes;
      if (!kids) continue;
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
    }
    const text = parts.join(" ").trim();
    if (text) accName = text.slice(0, 80);
  }
  if (!accName) {
    const title = el.getAttribute("title")?.trim();
    if (title) accName = title.slice(0, 80);
  }

  let labelText = "";
  if (el.id) {
    const escaped = g.CSS?.escape(el.id) ?? el.id;
    const lab = g.document.querySelector(`label[for="${escaped}"]`);
    const t = lab?.innerText.trim() ?? "";
    if (t) labelText = t.slice(0, 80);
  }
  if (!labelText) {
    const wrap = el.closest("label");
    const t = wrap?.innerText.trim() ?? "";
    if (t) labelText = t.slice(0, 80);
  }

  return {
    testId: el.getAttribute("data-testid")?.trim() ?? "",
    nameAttr: el.getAttribute("name")?.trim() ?? "",
    role,
    accName,
    labelText,
    required: Boolean(el.required) || el.getAttribute("aria-required") === "true",
    tag,
    inputType,
    contentEditable: el.getAttribute("contenteditable") === "true",
    insideDialog: (() => {
      const host = el.closest("dialog, [role='dialog'], [aria-modal='true']");
      return host !== null && host !== el;
    })(),
  };
}

function fieldTypeOf(info: WidgetRead): FieldType {
  if (info.tag === "textarea") return "textarea";
  if (info.tag === "select") return "select";
  if (info.contentEditable) return "text";
  const t = info.inputType;
  if (
    t === "email" ||
    t === "password" ||
    t === "checkbox" ||
    t === "radio" ||
    t === "number" ||
    t === "date"
  ) {
    return t;
  }
  if (t === "datetime-local") return "datetime";
  return "text";
}

function toCandidate(kind: "field" | "action", info: WidgetRead): Candidate | undefined {
  let by: Candidate["by"];
  let value: string;
  let name: string | undefined;

  if (info.testId) {
    by = "testId";
    value = info.testId;
  } else if (kind === "field" && info.nameAttr) {
    by = "name";
    value = info.nameAttr;
  } else if (info.role && info.accName) {
    by = "role";
    value = info.role;
    name = info.accName;
  } else if (info.labelText) {
    by = "label";
    value = info.labelText;
  } else {
    return undefined;
  }

  return {
    kind,
    by,
    value,
    ...(name ? { name } : {}),
    ...(kind === "field" ? { type: fieldTypeOf(info), required: info.required } : {}),
    resolves: false,
  };
}

async function collectKind(
  root: Page | PwLocator,
  kind: "field" | "action",
  selector: string,
  opts: CollectOptions | undefined,
  seen: Set<string>,
  out: Candidate[],
): Promise<void> {
  const loc = root.locator(selector);
  const n = await loc.count();
  for (let i = 0; i < n; i++) {
    const item = loc.nth(i);
    if (!(await item.isVisible())) continue;
    const info = await item.evaluate(readWidget);
    if (opts?.excludeVisibleDialogs && info.insideDialog) continue;
    if (kind === "field") {
      if (info.inputType === "hidden") continue;
      if (info.inputType === "submit" || info.inputType === "button") continue;
    }
    if (kind === "field" && /row selection|toggle row selection/i.test(`${info.accName} ${info.labelText}`)) {
      continue;
    }
    const candidate = toCandidate(kind, info);
    if (!candidate) continue;
    const key = identityKey("", candidate.by, candidate.value, candidate.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
}

export async function collectCandidates(
  root: Page | PwLocator,
  opts?: CollectOptions,
): Promise<Candidate[]> {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  await collectKind(root, "field", FIELD_SELECTOR, opts, seen, out);
  await collectKind(root, "action", ACTION_SELECTOR, opts, seen, out);
  return out;
}
