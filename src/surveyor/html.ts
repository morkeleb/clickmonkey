import { HtmlValidate } from "html-validate";
import { mergeQualityIssues, type QualityIssue } from "../schema/quality.js";

const validator = new HtmlValidate({
  root: true,
  extends: ["html-validate:standard"],
  elements: ["html5"],
  rules: {
    "void-style": "off",
    "attr-quotes": "off",
    "no-trailing-whitespace": "off",
  },
});

export async function validateHtml(markup: string): Promise<QualityIssue[]> {
  const report = await validator.validateString(markup);
  const issues: QualityIssue[] = [];
  for (const result of report.results) {
    for (const msg of result.messages) {
      if (!msg.ruleId || !msg.message) continue;
      issues.push({
        source: "html",
        rule: msg.ruleId,
        severity: msg.severity >= 2 ? "error" : "warning",
        message: msg.message,
        count: 1,
      });
    }
  }
  return mergeQualityIssues(issues);
}
