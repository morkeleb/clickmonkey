import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { trackDocumentResponses } from "../oracles/http.js";

export interface RunHandle {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

const DEFAULT_TIMEOUT = 30_000;

export async function withRun<T>(
  opts: { headed?: boolean; timeout?: number; storageState?: string },
  fn: (h: RunHandle) => Promise<T>,
): Promise<T> {
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  const browser = await chromium.launch({ headless: !opts.headed });
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  try {
    context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      storageState: opts.storageState,
    });
    context.setDefaultTimeout(timeout);
    page = await context.newPage();
    trackDocumentResponses(page);
    return await fn({ browser, context, page });
  } finally {
    if (page) await page.close().catch(() => undefined);
    if (context) await context.close().catch(() => undefined);
    await browser.close();
  }
}
