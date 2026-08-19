import { stdin as input, stdout as output } from "node:process";
import type { RunSummary } from "../persist/runs.js";

/** Ask which runs to include. `--runs` / `--all` skip this. Nothing is pre-checked. */
export async function promptRuns(runs: RunSummary[]): Promise<string[]> {
  if (runs.length === 0) return [];
  if (!input.isTTY || !output.isTTY) {
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
