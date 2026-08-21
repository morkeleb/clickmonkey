import type { UiFault } from "@schema/ui";

export function parseUiFault(raw: unknown): UiFault | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (o.error !== true) return undefined;
  if (typeof o.title !== "string" || typeof o.message !== "string" || typeof o.copy !== "string") {
    return undefined;
  }
  return {
    error: true,
    title: o.title,
    message: o.message,
    hint: typeof o.hint === "string" ? o.hint : "",
    ...(typeof o.detail === "string" && o.detail ? { detail: o.detail } : {}),
    copy: o.copy,
  };
}

export function faultFromHttpError(status: number, body: string): UiFault {
  const trimmed = body.trim();
  try {
    const parsed = parseUiFault(JSON.parse(trimmed) as unknown);
    if (parsed) return parsed;
  } catch {
    /* not JSON */
  }
  const copy = trimmed
    ? `UI request failed (${status})\n\n${trimmed}`
    : `UI request failed (${status})`;
  return {
    error: true,
    title: "UI request failed",
    message: trimmed ? trimmed.replace(/\s+/g, " ").slice(0, 240) : `HTTP ${status}`,
    hint: [
      "Use Restart UI, or from the workspace folder:",
      "",
      "  clickmonkey ui --stop",
      "  clickmonkey ui --port 4174 --no-open",
      "",
      "Hard-refresh this tab (Cmd+Shift+R / Ctrl+Shift+R).",
    ].join("\n"),
    ...(trimmed ? { detail: trimmed } : {}),
    copy,
  };
}
