import type { Page } from "playwright";
import type { Locator } from "../schema/locator.js";
import type { PageModel, Widget } from "../schema/page-model.js";
import { resolveCount } from "../surveyor/resolve.js";

export interface LiveFailure {
  widgetRef: string;
  count: number;
}

function asLocator(widget: Widget): Locator {
  return widget.name === undefined
    ? { by: widget.by, value: widget.value }
    : { by: widget.by, value: widget.value, name: widget.name };
}

export async function liveValidate(
  page: Page,
  model: PageModel,
  opts?: { pageId?: string; immediateOnly?: boolean },
): Promise<{ ok: boolean; failures: LiveFailure[] }> {
  const immediateOnly = opts?.immediateOnly ?? true;
  const target = opts?.pageId
    ? model.pages.find((p) => p.id === opts.pageId)
    : model.pages[0];

  if (!target) {
    return {
      ok: false,
      failures: [{ widgetRef: `page:${opts?.pageId ?? "?"}`, count: 0 }],
    };
  }

  const failures: LiveFailure[] = [];

  const ready = await resolveCount(page, target.ready);
  if (ready.status !== "ok") {
    failures.push({ widgetRef: `page:${target.id}.ready`, count: ready.count });
  }

  const pageSurface = target.surfaces.find((s) => s.kind === "page");
  if (pageSurface) {
    for (const widget of [...pageSurface.fields, ...pageSurface.actions]) {
      const resolved = await resolveCount(page, asLocator(widget));
      if (resolved.status !== "ok") {
        failures.push({
          widgetRef: `${pageSurface.id}.${widget.id}`,
          count: resolved.count,
        });
      }
    }
  }

  if (immediateOnly) {
    return { ok: failures.length === 0, failures };
  }

  return { ok: failures.length === 0, failures };
}
