import type { Page } from "playwright";
import { pageErrorTitle } from "../schema/finding.js";
import { normalizeQualityMessage } from "../schema/quality.js";
import type { OracleFinding } from "./http.js";

export type RuntimeRecord = {
  source: "console" | "pageError";
  rule: string;
  severity: "error" | "warning";
  message: string;
  url: string;
};

export function attachPageErrorOracle(
  page: Page,
  push: (f: OracleFinding) => void,
  record?: (event: RuntimeRecord) => void,
): void {
  const seenPageErrors = new Set<string>();
  page.on("pageerror", (err) => {
    const raw = err.message || String(err);
    const message = `${pageErrorTitle(raw)} (page threw; this is not field validation)`;
    const key = normalizeQualityMessage(raw);
    if (!seenPageErrors.has(key)) {
      seenPageErrors.add(key);
      push({ kind: "pageError", message });
    }
    try {
      record?.({
        source: "pageError",
        rule: "pageError",
        severity: "error",
        message,
        url: page.url(),
      });
    } catch {
      // ledger write must not swallow the finding
    }
  });
  page.on("console", (msg) => {
    const type = msg.type();
    if (type !== "error" && type !== "warning") return;
    const text = msg.text();
    if (!text.trim() || text.includes("favicon")) return;
    try {
      record?.({
        source: "console",
        rule: type === "error" ? "console.error" : "console.warning",
        severity: type === "error" ? "error" : "warning",
        message: text,
        url: page.url(),
      });
    } catch {
      // ledger write must not stall the walk
    }
  });
}
