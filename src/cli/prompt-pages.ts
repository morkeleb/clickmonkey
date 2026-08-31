import { stdin as input, stdout as output } from "node:process";
import type { PageGcRow } from "../persist/pages.js";

function isTty(): boolean {
  return Boolean(input.isTTY && output.isTTY);
}

export function dropPageChoices(rows: PageGcRow[]): Array<{
  name: string;
  value: string;
  checked: boolean;
  description?: string;
}> {
  return rows.map((row) => {
    const bits = [row.id, row.path];
    if (row.notFound) bits.push("404");
    if (row.special) bits.push(row.special);
    return {
      name: bits.join("  "),
      value: row.id,
      checked: row.recommend,
      ...(row.why || row.special
        ? { description: row.why ?? `not recommended (${row.special})` }
        : {}),
    };
  });
}

/** Recommended rooms are pre-checked. `--drop` skips this. Non-TTY returns []. */
export async function promptDropPages(rows: PageGcRow[]): Promise<string[]> {
  if (rows.length === 0) return [];
  if (!isTty()) return [];
  const { checkbox } = await import("@inquirer/prompts");
  return checkbox({
    message: "Drop from the sitemap?",
    required: false,
    pageSize: Math.min(16, rows.length),
    choices: dropPageChoices(rows),
  });
}
