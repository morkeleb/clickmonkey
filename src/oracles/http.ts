import type { Page } from "playwright";
import type { FindingKind } from "../schema/finding.js";

export type OracleFinding = {
  kind: FindingKind;
  message: string;
  httpStatus?: number;
  url?: string;
  resourceType?: string;
};

const WATCHED = new Set(["document", "xhr", "fetch"]);

const lastDocumentByPage = new WeakMap<Page, { status: number; url: string }>();
const tracked = new WeakSet<Page>();

export function trackDocumentResponses(page: Page): void {
  if (tracked.has(page)) return;
  tracked.add(page);
  page.on("response", (response) => {
    if (response.request().resourceType() !== "document") return;
    lastDocumentByPage.set(page, { status: response.status(), url: response.url() });
  });
}

export function lastDocument(page: Page): { status: number; url: string } | undefined {
  return lastDocumentByPage.get(page);
}

export function isDocumentNotFound(page: Page): boolean {
  return lastDocument(page)?.status === 404;
}

export function attachHttpOracle(page: Page, push: (f: OracleFinding) => void): void {
  trackDocumentResponses(page);
  page.on("response", (response) => {
    const type = response.request().resourceType();
    if (!WATCHED.has(type)) return;
    const status = response.status();
    if (status < 400) return;
    const url = response.url();
    if (url.includes("favicon")) return;
    const notFound = status === 404;
    push({
      kind: notFound ? "notFound" : "httpError",
      message: notFound
        ? `HTTP 404 ${response.request().method()} ${url}`
        : `HTTP ${status} ${response.request().method()} ${url}`,
      httpStatus: status,
      url,
      resourceType: type,
    });
  });
}
