import { formSubmitIsListPager, isFormSubmit } from "../brains/unleash.js";
import type { ShownAction } from "../schema/view.js";

export function isPotentialWrite(
  action: { id: string; name?: string; by: string },
  inputType?: string,
): boolean {
  if (action.id === "submit") return true;
  if (action.by === "role" && /^submit$/i.test(action.name ?? "")) return true;
  if (inputType === "submit") return true;
  return false;
}

function asShown(action: {
  id: string;
  name?: string;
  label?: string;
  opens?: string;
  nav?: boolean;
  role?: string;
}): ShownAction {
  const label = action.label ?? action.name;
  return {
    id: action.id,
    ...(action.opens ? { opens: action.opens } : {}),
    ...(label ? { label } : {}),
    ...(action.nav ? { nav: true } : {}),
    ...(action.role ? { role: action.role } : {}),
  };
}

/** Same classifier unleash uses for form submit (wizard Next vs list pager). */
export function looksLikeSubmitClick(
  action: { id: string; name?: string; by: string; opens?: string; nav?: boolean; role?: string },
  siblings?: readonly { id: string; name?: string; opens?: string; nav?: boolean; role?: string }[],
): boolean {
  const shown = asShown(action);
  const sibs = (siblings ?? []).map(asShown);
  return isFormSubmit(shown, undefined, formSubmitIsListPager(sibs));
}
