export function isPotentialWrite(
  action: { id: string; name?: string; by: string },
  inputType?: string,
): boolean {
  if (action.id === "submit") return true;
  if (action.by === "role" && /^submit$/i.test(action.name ?? "")) return true;
  if (inputType === "submit") return true;
  return false;
}
