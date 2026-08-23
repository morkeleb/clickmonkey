import { stdin as input, stdout as output } from "node:process";
import type { ReportMeta } from "../schema/report.js";
import type { ReportFinding } from "../reports/prune.js";

function isTty(): boolean {
  return Boolean(input.isTTY && output.isTTY);
}

export async function promptReport(reports: ReportMeta[]): Promise<string> {
  if (reports.length === 0) return "";
  if (!isTty()) return reports[0]?.id ?? "";
  const { select } = await import("@inquirer/prompts");
  return select({
    message: "Which report to prune?",
    choices: reports.map((r) => ({
      name: `${r.title}  ${r.id}`,
      value: r.id,
    })),
  });
}

export async function promptFalsePositives(
  findings: ReportFinding[],
  suggested: Map<string, string>,
): Promise<string[]> {
  if (findings.length === 0) return [];
  if (!isTty()) return [];
  const { checkbox } = await import("@inquirer/prompts");
  return checkbox({
    message: "Which findings are false positives?",
    required: false,
    pageSize: Math.min(16, findings.length),
    choices: findings.map((f) => {
      const reason = suggested.get(f.key) ?? suggested.get(f.id) ?? [...f.ids].map((id) => suggested.get(id)).find(Boolean);
      return {
        name: `${f.severity} ${f.kind}  ${f.title}${f.runIds[0] ? `  ${f.runIds[0]}` : ""}`,
        value: f.key,
        checked: Boolean(reason),
        ...(reason ? { description: reason } : {}),
      };
    }),
  });
}
