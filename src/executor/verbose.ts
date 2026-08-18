import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import type { View } from "../schema/view.js";
import { formatView } from "./view.js";
import type { RunState } from "./run.js";

export const VERBOSE_DIR = "verbose";

export function verboseDir(outDir: string): string {
  return join(outDir, VERBOSE_DIR);
}

function pad(n: number): string {
  return String(n).padStart(3, "0");
}

export async function dumpVerbose(opts: {
  page: Page;
  outDir: string;
  n: number;
  line: string;
  pageId: string;
  view?: View;
}): Promise<void> {
  const dir = verboseDir(opts.outDir);
  mkdirSync(dir, { recursive: true });
  const base = pad(opts.n);
  const html = await opts.page.content().catch(() => "");
  writeFileSync(join(dir, `${base}.html`), html, "utf8");
  if (opts.view) {
    writeFileSync(join(dir, `${base}.view.txt`), formatView(opts.view), "utf8");
  }
  appendFileSync(
    join(dir, "index.jsonl"),
    `${JSON.stringify({
      n: opts.n,
      line: opts.line,
      url: opts.page.url(),
      pageId: opts.pageId,
      html: `${base}.html`,
      ...(opts.view ? { view: `${base}.view.txt` } : {}),
    })}\n`,
    "utf8",
  );
}

export async function dumpVerboseState(
  state: RunState,
  line: string,
  view?: View,
): Promise<void> {
  if (!state.verbose) return;
  const n = state.verboseSeq ?? 0;
  state.verboseSeq = n + 1;
  await dumpVerbose({
    page: state.page,
    outDir: state.outDir,
    n,
    line,
    pageId: state.pageId,
    view,
  });
}
