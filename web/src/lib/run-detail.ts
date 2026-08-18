import { useEffect, useState } from "react";
import type { UiRunDetail } from "@schema/ui";

export async function fetchRunDetail(id: string): Promise<UiRunDetail> {
  const res = await fetch(`/api/runs/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`run ${res.status}`);
  return (await res.json()) as UiRunDetail;
}

export function useRunDetail(
  id: string | undefined,
  opts?: { live?: boolean },
): { detail: UiRunDetail | null; error: string | null } {
  const [detail, setDetail] = useState<UiRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    let inflight = false;

    async function load() {
      if (!id || inflight) return;
      inflight = true;
      try {
        const next = await fetchRunDetail(id);
        if (!cancelled) {
          setDetail(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "run failed");
      } finally {
        inflight = false;
      }
    }

    void load();
    const ms = opts?.live ? 2000 : 8000;
    const timer = window.setInterval(() => {
      void load();
    }, ms);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [id, opts?.live]);

  return { detail, error };
}

export function shortHref(href: string): string {
  try {
    const url = new URL(href);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return href;
  }
}

export function clockOf(ts: string): string {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return ts;
  return new Date(t).toISOString().slice(11, 23);
}
