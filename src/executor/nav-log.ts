import type { Page, Response } from "playwright";
import { appendEvent } from "../persist/events.js";

export type NavVia = "redirect" | "document" | "commit" | "sameDocument";

export type NavMeta = {
  step?: string;
  pageId?: string;
  phase?: string;
};

export type NavEvent = {
  ts: string;
  type: "nav";
  from: string;
  to: string;
  via: NavVia;
  status?: number;
  method?: string;
  step?: string;
  pageId?: string;
  phase?: string;
};

const attached = new WeakSet<Page>();

/** UTC clock for live lines. Same instant as JSONL `ts`. */
export function formatClock(at: Date = new Date()): string {
  return at.toISOString().slice(11, 23);
}

export function formatLiveLine(line: string, at: Date = new Date()): string {
  return `${formatClock(at)} ${line}`;
}

function resolveLocation(base: string, location: string): string {
  try {
    return new URL(location, base).href;
  } catch {
    return location;
  }
}

export function formatNavLine(
  event: Pick<NavEvent, "from" | "to" | "via" | "status" | "method" | "step" | "phase">,
): string {
  const status = event.status !== undefined ? String(event.status) : event.via === "sameDocument" ? "~" : "   ";
  const method = event.method ? ` ${event.method}` : "";
  const core =
    event.from && event.from !== event.to && event.from !== "about:blank"
      ? `nav ${status}${method} ${event.from} → ${event.to}`
      : `nav ${status}${method} ${event.to}`;
  const tag = event.step ?? event.phase;
  return tag ? `${core}  [${tag}]` : core;
}

export function logLand(
  path: string,
  info: { url: string; pageId: string; hoppable: string[]; echo?: { write(chunk: string): unknown } },
): void {
  appendEvent(path, {
    ts: new Date().toISOString(),
    type: "land",
    url: info.url,
    pageId: info.pageId,
    hoppable: info.hoppable,
  });
  const hops = info.hoppable.length > 0 ? info.hoppable.join(",") : "(none)";
  info.echo?.write(`${formatLiveLine(`land  ${info.url}  page=${info.pageId}  hoppable=${hops}`)}\n`);
}

export function logBrainDecide(
  path: string,
  info: { line: string; note?: string; good?: string },
): void {
  const note = info.note?.trim();
  const good = info.good?.trim();
  if (!note && !good) return;
  appendEvent(path, {
    ts: new Date().toISOString(),
    type: "brain",
    line: info.line,
    ...(note ? { note } : {}),
    ...(good ? { good } : {}),
  });
}

export function logStepStart(
  path: string,
  info: { line: string; pageId: string; phase: string; echo?: { write(chunk: string): unknown } },
): number {
  const started = Date.now();
  appendEvent(path, {
    ts: new Date(started).toISOString(),
    type: "step",
    line: info.line,
    pageId: info.pageId,
    phase: info.phase,
  });
  info.echo?.write(`${formatLiveLine(`step  ${info.line}  [${info.phase} ${info.pageId}]`)}\n`);
  return started;
}

export function logStepDone(
  path: string,
  info: {
    line: string;
    ok: boolean;
    started: number;
    finding?: string;
    echo?: { write(chunk: string): unknown };
  },
): void {
  const ms = Date.now() - info.started;
  appendEvent(path, {
    ts: new Date().toISOString(),
    type: "stepDone",
    line: info.line,
    ok: info.ok,
    ms,
    ...(info.finding ? { finding: info.finding } : {}),
  });
  const outcome = info.ok ? "ok" : (info.finding ?? "fail");
  info.echo?.write(`${formatLiveLine(`${outcome.padEnd(4)} ${info.line}  ${ms}ms`)}\n`);
}

function shouldIgnore(href: string): boolean {
  return href === "" || href === "about:blank";
}

/** Main-frame navigations: redirects, document loads, and same-document URL changes. */
export async function attachNavLog(
  page: Page,
  opts: { path: string; echo?: { write(chunk: string): unknown }; meta?: NavMeta },
): Promise<void> {
  if (attached.has(page)) return;
  attached.add(page);

  let last = page.url();

  const emit = (partial: Omit<NavEvent, "ts" | "type">): void => {
    if (shouldIgnore(partial.to)) return;
    if (partial.to === last && partial.from === last) return;
    if (partial.to === last && partial.via === "commit") return;
    const event: NavEvent = {
      ts: new Date().toISOString(),
      type: "nav",
      ...partial,
      ...(opts.meta?.step ? { step: opts.meta.step } : {}),
      ...(opts.meta?.pageId ? { pageId: opts.meta.pageId } : {}),
      ...(opts.meta?.phase ? { phase: opts.meta.phase } : {}),
    };
    last = event.to;
    appendEvent(opts.path, event);
    opts.echo?.write(`${formatLiveLine(formatNavLine(event))}\n`);
  };

  page.on("response", (response: Response) => {
    const req = response.request();
    if (!req.isNavigationRequest()) return;
    if (req.frame() !== page.mainFrame()) return;
    if (req.resourceType() !== "document") return;
    const status = response.status();
    const location = response.headers().location;
    const redirected = status >= 300 && status < 400 && Boolean(location);
    const to = redirected && location ? resolveLocation(req.url(), location) : response.url();
    emit({
      from: last,
      to,
      via: redirected ? "redirect" : "document",
      status,
      method: req.method(),
    });
  });

  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    emit({ from: last, to: frame.url(), via: "commit" });
  });

  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Page.enable");
    cdp.on("Page.navigatedWithinDocument", (payload: { url?: string }) => {
      if (!payload.url) return;
      emit({ from: last, to: payload.url, via: "sameDocument" });
    });
  } catch {
    // Chromium CDP only; document navigations still log.
  }
}
