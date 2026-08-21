export function isPotentialWrite(
  action: { id: string; name?: string; by: string },
  inputType?: string,
): boolean {
  if (action.id === "submit") return true;
  if (action.by === "role" && /^submit$/i.test(action.name ?? "")) return true;
  if (inputType === "submit") return true;
  return false;
}

const COMMIT_ID = /(^|_)(submit|save|create|apply|publish|send|update|confirm)$/i;
const NEXT_ID = /(^|_)(next|continue)$/i;
const PREV_ID = /(^|_)(previous|prev)$/i;
const ADD_ROW_ID = /(^|_)add_(row|filter|item|line)(_|$)/i;

/** Commit click for the after-fill validation oracle. Skips openers and list pagers. */
export function looksLikeSubmitClick(
  action: { id: string; name?: string; by: string; opens?: string },
  siblings?: readonly { id: string }[],
): boolean {
  if (action.opens) return false;
  if (ADD_ROW_ID.test(action.id)) return false;
  if (isPotentialWrite(action)) return true;
  if (COMMIT_ID.test(action.id)) return true;
  if (NEXT_ID.test(action.id)) {
    if (siblings?.some((a) => PREV_ID.test(a.id))) return false;
    return true;
  }
  return false;
}
