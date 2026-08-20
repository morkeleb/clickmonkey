import type { Finding } from "../schema/finding.js";

export function cannedReport(finding: Finding): string {
  switch (finding.kind) {
    case "pageError":
      return [
        `# ${finding.id}`,
        "",
        `Uncaught JavaScript error on ${finding.url ?? "the page"} after a step.`,
        "",
        finding.message,
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
    case "expectFailed":
      return [
        `# ${finding.id}`,
        "",
        "Expected validation / expect failed.",
        "",
        finding.message,
        "",
      ].join("\n");
    case "fenceViolation":
      return [`# ${finding.id}`, "", "Left the leash.", "", finding.message, ""].join("\n");
    case "uiIssue":
      return [
        `# ${finding.id}`,
        "",
        "UI issue captured from an explicit screenshot step.",
        "",
        finding.message,
        "",
        finding.screenshotPath ? `Screenshot: ${finding.screenshotPath}` : "",
        "",
      ].join("\n");
    case "visualIssue":
      return [
        `# ${finding.id}`,
        "",
        "High-confidence visual issue from the vision model.",
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
