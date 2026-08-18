import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { RunSummary } from "../persist/runs.js";

/** Ask which runs to include. `--runs` / `--all` skip this. */
export async function promptRuns(runs: RunSummary[]): Promise<string[]> {
  if (runs.length === 0) return [];
  if (!input.isTTY || !output.isTTY) {
    return runs.filter((r) => r.findingCount > 0).map((r) => r.id);
  }
  const lines = runs.map((r, i) => `  ${i + 1}) ${r.id}  ${r.findingCount} finding${r.findingCount === 1 ? "" : "s"}`);
  output.write(`Runs:\n${lines.join("\n")}\nInclude which? (1,2 or all) `);
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question("")).trim().toLowerCase();
    if (!answer || answer === "all") return runs.map((r) => r.id);
    const ids: string[] = [];
    for (const part of answer.split(/[,\s]+/)) {
      const n = Number(part);
      if (!Number.isInteger(n) || n < 1 || n > runs.length) {
        throw new Error(`invalid selection: ${part}`);
      }
      ids.push(runs[n - 1]!.id);
    }
    return ids;
  } finally {
    rl.close();
  }
}
