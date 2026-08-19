import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "playwright";
import { joinWheres, mergeQualityIssues, type QualityIssue } from "../schema/quality.js";
import { describeQualityWhere } from "./where.js";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

export async function scanA11y(page: Page): Promise<QualityIssue[]> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const issues: QualityIssue[] = [];
  for (const v of results.violations) {
    if (!v.id || v.nodes.length === 0) continue;
    const impact = v.impact ?? "moderate";
    let where: string | undefined;
    for (const node of v.nodes) {
      const sel = Array.isArray(node.target)
        ? node.target.map((t) => (typeof t === "string" ? t : String(t))).find((s) => s.trim())
        : undefined;
      where = joinWheres(where, describeQualityWhere({ html: node.html, selector: sel }));
    }
    issues.push({
      source: "a11y",
      rule: v.id,
      severity: impact === "critical" || impact === "serious" ? "error" : "warning",
      message: v.help || v.description || v.id,
      count: v.nodes.length,
      ...(where ? { where } : {}),
    });
  }
  return mergeQualityIssues(issues);
}
