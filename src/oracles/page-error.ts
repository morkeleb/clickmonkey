import type { Page } from "playwright";
import type { OracleFinding } from "./http.js";

export function attachPageErrorOracle(page: Page, push: (f: OracleFinding) => void): void {
  page.on("pageerror", (err) => {
    push({
      kind: "pageError",
      message: err.message || String(err),
    });
  });
}
