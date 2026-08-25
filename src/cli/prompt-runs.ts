import { stdin as input, stdout as output } from "node:process";
import type { RunSummary } from "../persist/runs.js";

function isTty(): boolean {
  return Boolean(input.isTTY && output.isTTY);
}

/** Ask which runs to include. `--runs` / `--all` skip this. Nothing is pre-checked. */
export async function promptRuns(runs: RunSummary[]): Promise<string[]> {
  if (runs.length === 0) return [];
  if (!isTty()) {
    return runs.filter((r) => r.findingCount > 0).map((r) => r.id);
  }
  const { checkbox } = await import("@inquirer/prompts");
  return checkbox({
    message: "Which runs to include in the report?",
    required: true,
    pageSize: Math.min(16, runs.length),
    choices: runs.map((r) => ({
      name: `${r.id}  ${r.findingCount} finding${r.findingCount === 1 ? "" : "s"}`,
      value: r.id,
    })),
  });
}

/** Cap unique-to-a-route pages vs list them all. `--quality-full` skips this. */
export async function promptQualityFull(): Promise<boolean> {
  if (!isTty()) return false;
  const { select } = await import("@inquirer/prompts");
  return select({
    message: "Pages with issues?",
    default: false,
    choices: [
      // 8 must match LEFTOVER_PAGE_CAP (and README / issue-classes). Do not import findings-report here.
      { name: "Default — top 8 pages with issues", value: false },
      { name: "Full — every page with issues", value: true },
    ],
  });
}
