import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "playwright";
import { mergeQualityIssues, type QualityIssue } from "../schema/quality.js";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

export async function scanA11y(page: Page): Promise<QualityIssue[]> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const issues: QualityIssue[] = [];
  for (const v of results.violations) {
    if (!v.id || v.nodes.length === 0) continue;
    const impact = v.impact ?? "moderate";
    issues.push({
      source: "a11y",
      rule: v.id,
      severity: impact === "critical" || impact === "serious" ? "error" : "warning",
      message: v.help || v.description || v.id,
      count: v.nodes.length,
    });
  }
  return mergeQualityIssues(issues);
}
