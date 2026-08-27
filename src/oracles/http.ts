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

function collapsed(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** "404" as its own token, not a digit in 4040 or 1404. */
function has404Token(text: string): boolean {
  return /(?:^|[^\d])404(?:[^\d]|$)/.test(text);
}

/**
 * Next.js / SPA 404 with HTTP 200 (soft nav).
 * Matches the default copy even when 404 is a styled div inside app chrome,
 * not `h1.next-error-h1`. A KPI that merely contains the number 404 is not a miss.
 */
export function looksLikeNotFoundUi(info: {
  title: string;
  bodyText: string;
  headings: string[];
  nextError: boolean;
  mainText?: string;
}): boolean {
  const body = collapsed(info.bodyText);
  const main = collapsed(info.mainText ?? "");
  const text = main || body;
  const nextCopy =
    /this page could not be found/i.test(main) || /this page could not be found/i.test(body);
  const pageNotFound = /\bpage not found\b/i.test(main) || /\bpage not found\b/i.test(body);
  if (info.nextError && (nextCopy || pageNotFound)) return true;
  if (/^\s*404\b/.test(info.title) && /not found/i.test(info.title)) return true;
  const h404 = info.headings.some((t) => {
    const s = collapsed(t);
    return /^404$/.test(s) || /^404\s*[\u007c|：:—-]/u.test(s) || /page not found/i.test(s);
  });
  if (h404 && (nextCopy || pageNotFound)) return true;
  // Default Next.js copy in the main pane (layout 404: big "404" + that sentence, often not an h1).
  if (nextCopy && has404Token(text)) return true;
  return false;
}

export async function pageShowsNotFound(page: Page): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const info = await page.evaluate(() => {
        const g = globalThis as unknown as {
          document: {
            title: string;
            body?: { innerText?: string };
            querySelector(sel: string): { innerText?: string } | null;
            querySelectorAll(sel: string): ArrayLike<{ innerText?: string }>;
          };
        };
        const doc = g.document;
        const main = doc.querySelector("main, [role='main']");
        return {
          title: doc.title || "",
          bodyText: doc.body?.innerText || "",
          mainText: main?.innerText || "",
          headings: Array.from(doc.querySelectorAll("h1, h2")).map((el) => el.innerText || ""),
          nextError: Boolean(doc.querySelector("h1.next-error-h1, .next-error-h1")),
        };
      });
      return looksLikeNotFoundUi(info);
    } catch {
      if (attempt === 0) continue;
      return false;
    }
  }
  return false;
}

export async function isNotFoundPage(page: Page): Promise<boolean> {
  if (isDocumentNotFound(page)) return true;
  return pageShowsNotFound(page);
}

const JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]+/g;
const BEARER = /Bearer\s+\S+/gi;

function jsonErrorText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const o = value as Record<string, unknown>;
  for (const key of ["message", "errorMessage", "detail", "title", "error"]) {
    const nested = jsonErrorText(o[key]);
    if (nested) return nested;
  }
  return "";
}

/** Short server error text for a finding — not the raw dump, never a JWT. */
export function summarizeHttpErrorBody(raw: string, max = 240): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  let text = collapsed;
  try {
    const fromJson = jsonErrorText(JSON.parse(raw) as unknown);
    if (fromJson) text = fromJson;
  } catch {
    // plain text / HTML toast copy
  }
  text = text.replace(JWT, "[redacted]").replace(BEARER, "Bearer [redacted]");
  text = text.replace(/\s+/g, " ").trim();
  if (text.length > max) text = `${text.slice(0, max - 1)}…`;
  return text;
}

const httpFlush = new WeakMap<Page, Promise<void>[]>();

export async function flushHttpOracle(page: Page): Promise<void> {
  const jobs = httpFlush.get(page) ?? [];
  httpFlush.set(page, []);
  await Promise.all(jobs);
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
    const method = response.request().method();
    const line = notFound ? `HTTP 404 ${method} ${url}` : `HTTP ${status} ${method} ${url}`;
    const job = (async () => {
      let detail = "";
      try {
        detail = summarizeHttpErrorBody(await response.text());
      } catch {
        detail = "";
      }
      push({
        kind: notFound ? "notFound" : "httpError",
        message: detail ? `${line}: ${detail}` : line,
        httpStatus: status,
        url,
        resourceType: type,
      });
    })();
    const q = httpFlush.get(page) ?? [];
    q.push(job);
    httpFlush.set(page, q);
  });
}
