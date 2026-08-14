import type { Log } from "../schema/log.js";

/** Drop steps before the last `open`. Keep `# bug:` / `# found:` / comments. */
export function compactLog(log: Log): Log {
  let lastOpen = -1;
  for (let i = 0; i < log.steps.length; i++) {
    if (log.steps[i]?.kind === "open") lastOpen = i;
  }
  return {
    ...log,
    steps: lastOpen <= 0 ? [...log.steps] : log.steps.slice(lastOpen),
  };
}
