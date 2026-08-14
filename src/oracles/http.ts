import type { Page } from "playwright";
import type { FindingKind } from "../schema/finding.js";

export type OracleFinding = {
  kind: FindingKind;
  message: string;
  httpStatus?: number;
  url?: string;
};

const WATCHED = new Set(["document", "xhr", "fetch"]);

export function attachHttpOracle(page: Page, push: (f: OracleFinding) => void): void {
  page.on("response", (response) => {
    const type = response.request().resourceType();
    if (!WATCHED.has(type)) return;
    const status = response.status();
    if (status < 400) return;
    const url = response.url();
    if (url.includes("favicon")) return;
    push({
      kind: "httpError",
      message: `HTTP ${status} ${response.request().method()} ${url}`,
      httpStatus: status,
      url,
    });
  });
}
