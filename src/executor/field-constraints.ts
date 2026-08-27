import type { Locator as PwLocator } from "playwright";
import type { ShownFieldConstraints } from "../schema/view.js";

function intAttr(raw: string): number | undefined {
  if (!raw.trim()) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return undefined;
  return n;
}

/** Live min/max/length/pattern/autocomplete/placeholder on the control. Empty when none are set. */
export async function readFieldConstraints(loc: PwLocator): Promise<ShownFieldConstraints | undefined> {
  // Browser-side callback. Must stay closure-free for locator.evaluate.
  const raw = await loc
    .first()
    .evaluate((el) => {
      const node = el as {
        tagName: string;
        type?: string;
        getAttribute(name: string): string | null;
      };
      const min = node.getAttribute("min")?.trim() ?? "";
      const max = node.getAttribute("max")?.trim() ?? "";
      const minLength = node.getAttribute("minlength")?.trim() ?? "";
      const maxLength = node.getAttribute("maxlength")?.trim() ?? "";
      const step = node.getAttribute("step")?.trim() ?? "";
      const pattern = node.getAttribute("pattern")?.trim() ?? "";
      const autocomplete = node.getAttribute("autocomplete")?.trim() ?? "";
      const inputMode = node.getAttribute("inputmode")?.trim() ?? "";
      const placeholder = node.getAttribute("placeholder")?.trim() ?? "";
      const tag = (node.tagName || "").toLowerCase();
      const htmlType = tag === "input" ? (node.type || node.getAttribute("type") || "").toLowerCase() : "";
      return { min, max, minLength, maxLength, step, pattern, autocomplete, inputMode, htmlType, placeholder };
    })
    .catch(() => undefined);
  if (!raw) return undefined;

  const autocomplete =
    raw.autocomplete && raw.autocomplete !== "on" && raw.autocomplete !== "off"
      ? raw.autocomplete
      : undefined;
  const step = raw.step && raw.step !== "any" ? raw.step : undefined;
  const htmlType = raw.htmlType && raw.htmlType !== "text" ? raw.htmlType : undefined;
  const minLength = intAttr(raw.minLength);
  const maxLength = intAttr(raw.maxLength);
  const out: ShownFieldConstraints = {
    ...(raw.min ? { min: raw.min } : {}),
    ...(raw.max ? { max: raw.max } : {}),
    ...(minLength !== undefined ? { minLength } : {}),
    ...(maxLength !== undefined && maxLength > 0 ? { maxLength } : {}),
    ...(step ? { step } : {}),
    ...(raw.pattern ? { pattern: raw.pattern } : {}),
    ...(autocomplete ? { autocomplete } : {}),
    ...(raw.inputMode ? { inputMode: raw.inputMode } : {}),
    ...(htmlType ? { htmlType } : {}),
    ...(raw.placeholder ? { placeholder: raw.placeholder } : {}),
  };
  return Object.keys(out).length > 0 ? out : undefined;
}
