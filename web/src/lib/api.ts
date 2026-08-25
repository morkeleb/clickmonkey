import { useEffect, useState } from "react";
import type { UiEvent, UiFault, UiRun, UiSnapshot } from "@schema/ui";
import { faultFromHttpError } from "@/lib/fault";
import { fetchFirstJson, publicUrl, UiHttpError } from "@/lib/paths";

const EVENT_TYPES = ["hello", "map", "quality", "testability", "run", "nav"] as const;

function readSnapshot(raw: unknown): UiSnapshot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  return (raw as UiEvent).snapshot;
}

function readRuns(raw: unknown): UiRun[] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const runs = (raw as UiEvent).runs;
  return Array.isArray(runs) ? runs : undefined;
}

type FogPatch = NonNullable<UiEvent["lastFog"]>[string];

function readLastFog(raw: unknown): Record<string, FogPatch> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const fog = (raw as UiEvent).lastFog;
  if (!fog || typeof fog !== "object" || Array.isArray(fog)) return undefined;
  return fog;
}

function jobFogFromPatch(patch: FogPatch): UiSnapshot["graph"]["nodes"][number]["jobFog"] {
  const jobs = {
    ...(patch.map ? { map: patch.map } : {}),
    ...(patch.unleash ? { unleash: patch.unleash } : {}),
    ...(patch.nasty ? { nasty: patch.nasty } : {}),
  };
  return Object.keys(jobs).length > 0 ? jobs : undefined;
}

/** Full fog map: stamp present pages, drop times the server no longer has. */
export function applyLastFog(
  snapshot: UiSnapshot,
  lastFog: Record<string, FogPatch>,
): UiSnapshot {
  return {
    ...snapshot,
    graph: {
      ...snapshot.graph,
      nodes: snapshot.graph.nodes.map((node) => {
        const patch = lastFog[node.pageId];
        const { fogAt: _at, jobFog: _jobs, ...rest } = node;
        if (!patch) return rest;
        const jobFog = jobFogFromPatch(patch);
        return {
          ...rest,
          ...(patch.at ? { fogAt: patch.at } : {}),
          ...(jobFog ? { jobFog } : {}),
        };
      }),
    },
  };
}

export function useSnapshot(): {
  snapshot: UiSnapshot | null;
  error: string | null;
  fault: UiFault | null;
} {
  const [snapshot, setSnapshot] = useState<UiSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fault, setFault] = useState<UiFault | null>(null);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let retryTimer: number | undefined;
    let staticMode = false;

    async function loadSnapshot(): Promise<boolean> {
      try {
        const data = await fetchFirstJson<UiSnapshot>(["api/snapshot", "snapshot.json"]);
        if (!cancelled) {
          setSnapshot(data);
          setError(null);
          setFault(null);
        }
        return true;
      } catch (err) {
        if (!cancelled) {
          const next =
            err instanceof UiHttpError
              ? faultFromHttpError(err.status, err.body)
              : faultFromHttpError(0, err instanceof Error ? err.message : "snapshot failed");
          setFault(next);
          setError(next.copy);
        }
        return false;
      }
    }

    function applyMessage(data: string) {
      try {
        const parsed: unknown = JSON.parse(data);
        const next = readSnapshot(parsed);
        if (next && !cancelled) {
          setSnapshot(next);
          setError(null);
          setFault(null);
          return;
        }
        const runs = readRuns(parsed);
        const lastFog = readLastFog(parsed);
        if ((runs || lastFog) && !cancelled) {
          setSnapshot((prev) => {
            if (!prev) return prev;
            const next = lastFog ? applyLastFog(prev, lastFog) : prev;
            return runs ? { ...next, runs } : next;
          });
        }
      } catch {
        /* ignore malformed SSE payloads */
      }
    }

    function connect() {
      if (staticMode) return;
      source = new EventSource(publicUrl("api/events"));
      source.onmessage = (ev) => applyMessage(ev.data);
      for (const type of EVENT_TYPES) {
        source.addEventListener(type, (ev) => applyMessage((ev as MessageEvent).data));
      }
      source.onerror = () => {
        source?.close();
        source = null;
        if (cancelled || staticMode) return;
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

    void (async () => {
      try {
        const frozen = await fetchFirstJson<UiSnapshot>(["snapshot.json"]);
        if (cancelled) return;
        staticMode = true;
        setSnapshot(frozen);
        setError(null);
        setFault(null);
      } catch {
        const ok = await loadSnapshot();
        if (ok && !cancelled) connect();
      }
    })();

    const poll = window.setInterval(() => {
      if (staticMode) return;
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

  return { snapshot, error, fault };
}
