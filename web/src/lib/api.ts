import { useEffect, useState } from "react";
import type { UiEvent, UiSnapshot } from "@schema/ui";

const EVENT_TYPES = ["hello", "map", "quality", "testability", "run", "nav"] as const;

function readSnapshot(raw: unknown): UiSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const snapshot = (raw as UiEvent).snapshot;
  return snapshot;
}

export function useSnapshot(): {
  snapshot: UiSnapshot | null;
  error: string | null;
} {
  const [snapshot, setSnapshot] = useState<UiSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let retryTimer: number | undefined;

    async function loadSnapshot() {
      try {
        const res = await fetch("/api/snapshot");
        if (!res.ok) throw new Error(`snapshot ${res.status}`);
        const data = (await res.json()) as UiSnapshot;
        if (!cancelled) {
          setSnapshot(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "snapshot failed");
        }
      }
    }

    function applyMessage(data: string) {
      try {
        const parsed: unknown = JSON.parse(data);
        const next = readSnapshot(parsed);
        if (next && !cancelled) {
          setSnapshot(next);
          setError(null);
        }
      } catch {
        /* ignore malformed SSE payloads */
      }
    }

    function connect() {
      source = new EventSource("/api/events");
      source.onmessage = (ev) => applyMessage(ev.data);
      for (const type of EVENT_TYPES) {
        source.addEventListener(type, (ev) => applyMessage((ev as MessageEvent).data));
      }
      source.onerror = () => {
        source?.close();
        source = null;
        if (cancelled) return;
        retryTimer = window.setTimeout(connect, 1500);
      };
    }

    let inflight = false;
    async function loadOnce() {
      if (inflight) return;
      inflight = true;
      try {
        await loadSnapshot();
      } finally {
        inflight = false;
      }
    }

    void loadOnce();
    connect();
    const poll = window.setInterval(() => {
      if (source?.readyState === EventSource.OPEN) return;
      void loadOnce();
    }, 4000);

    return () => {
      cancelled = true;
      source?.close();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      window.clearInterval(poll);
    };
  }, []);

  return { snapshot, error };
}
