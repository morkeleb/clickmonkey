import { findingReportTitle, pageErrorExplanation, pageErrorTitle, type Finding } from "../schema/finding.js";

export function cannedReport(finding: Finding): string {
  switch (finding.kind) {
    case "pageError":
      return [
        `# ${finding.id}`,
        "",
        pageErrorTitle(finding.message),
        "",
        `Uncaught JavaScript error on ${finding.url ?? "the page"} after a step.`,
        "",
        pageErrorExplanation(finding.message),
        "",
      ].join("\n");
    case "httpError":
      return [
        `# ${finding.id}`,
        "",
        `HTTP ${finding.httpStatus ?? "error"} ${finding.url ?? ""}`.trim(),
        "",
        finding.message,
        "",
      ].join("\n");
    case "notFound":
      return [
        `# ${finding.id}`,
        "",
        "Not found (HTTP 404 or an in-app 404 page). The path is on the broken report, not the map.",
        "",
        finding.message,
        "",
      ].join("\n");
    case "expectFailed": {
      const heading = findingReportTitle(finding.kind, finding.message);
      const named =
        heading !== finding.message ||
        /validation did not catch|accepted empty/i.test(heading);
      return [
        `# ${finding.id}`,
        "",
        named ? heading : "Expected validation / expect failed.",
        "",
        finding.message,
        "",
      ].join("\n");
    }
    case "visualIssue":
      return [
        `# ${finding.id}`,
        "",
        "High-confidence visual issue from the DOM layout pass (or vision).",
        "",
        finding.message,
        "",
        finding.screenshotPath ? `Screenshot: ${finding.screenshotPath}` : "",
        "",
      ].join("\n");
    default:
      return [`# ${finding.id}`, "", `${finding.kind}: ${finding.message}`, ""].join("\n");
  }
}
