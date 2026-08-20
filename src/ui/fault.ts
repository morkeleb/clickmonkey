import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { UiFault, type UiFault as UiFaultT, type UiNotice } from "../schema/ui.js";

export const RESTART_UI_HINT = [
  "Stop the UI (Ctrl+C in the `clickmonkey ui` terminal), then from the workspace folder:",
  "",
  "  clickmonkey ui --port 4174 --no-open",
  "",
  "Hard-refresh this tab (Cmd+Shift+R / Ctrl+Shift+R). Walkers keep running; only the UI process needs a restart.",
].join("\n");

export function packageRoot(): string {
  return fileURLToPath(new URL("../..", import.meta.url));
}

function newestSrcMtime(dir: string): number {
  let newest = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let names: string[];
    try {
      names = readdirSync(cur);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name === "node_modules" || name === "dist" || name === "web") continue;
      const p = join(cur, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) stack.push(p);
      else if (name.endsWith(".ts") && st.mtimeMs > newest) newest = st.mtimeMs;
    }
  }
  return newest;
}

/** True when src changed after this process started — restart `clickmonkey ui`. */
export function sourceNewerThanStarted(startedAtMs: number, root = packageRoot()): boolean {
  const src = join(root, "src");
  if (!existsSync(src)) return false;
  return newestSrcMtime(src) > startedAtMs + 1000;
}

function issueDetail(err: unknown): string {
  if (err && typeof err === "object" && "issues" in err) {
    const issues = (err as { issues: unknown }).issues;
    if (Array.isArray(issues) && issues.length > 0) {
      return JSON.stringify(issues, null, 2);
    }
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function issueSummary(err: unknown): string {
  if (err && typeof err === "object" && "issues" in err) {
    const issues = (err as { issues: Array<{ message?: string; path?: unknown; keys?: unknown }> }).issues;
    const first = Array.isArray(issues) ? issues[0] : undefined;
    if (first?.message) {
      const path = Array.isArray(first.path) ? first.path.join(".") : "";
      const keys = Array.isArray(first.keys) ? first.keys.join(", ") : "";
      const extra = keys ? ` (${keys})` : "";
      return path ? `${first.message}${extra} at ${path}` : `${first.message}${extra}`;
    }
  }
  if (err instanceof Error) {
    const one = err.message.replace(/\s+/g, " ").trim();
    return one.length > 240 ? `${one.slice(0, 239)}…` : one;
  }
  return String(err);
}

export function formatUiFault(err: unknown): UiFaultT {
  const detail = issueDetail(err);
  const message = issueSummary(err);
  const title = "UI snapshot failed";
  const copy = [
    title,
    message,
    "",
    "Fix:",
    RESTART_UI_HINT,
    "",
    "Detail:",
    detail,
  ].join("\n");
  return UiFault.parse({
    error: true,
    title,
    message,
    hint: RESTART_UI_HINT,
    ...(detail !== message ? { detail } : {}),
    copy,
  });
}

export function staleUiNotice(): UiNotice {
  return {
    level: "warn",
    title: "This UI process is stale",
    message:
      "Source files changed after `clickmonkey ui` started. The map can look frozen (no monkey movement, no new screenshots) until you restart the UI.",
    hint: RESTART_UI_HINT,
  };
}

export function snapshotFailNotice(err: unknown): UiNotice {
  const fault = formatUiFault(err);
  return {
    level: "error",
    title: fault.title,
    message: `Showing the last good map. ${fault.message}`,
    hint: fault.hint,
    ...(fault.detail ? { detail: fault.detail } : {}),
  };
}
