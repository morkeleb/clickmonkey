import { useCallback, useEffect, useState } from "react";
import { ConfigPanel } from "@/components/config-panel";
import { FaultPanel, NoticeBanner } from "@/components/fault-panel";
import { MapCanvas } from "@/components/map-canvas";
import { NodeSheet } from "@/components/node-sheet";
import { ReportMarkdown } from "@/components/report-markdown";
import { RunPanel } from "@/components/run-panel";
import { ShotHost } from "@/components/shot";
import { Sidebar } from "@/components/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSnapshot } from "@/lib/api";
import { readMainFromLocation, writeMainToLocation, type MainView } from "@/lib/view";

export function App() {
  const { snapshot, error, fault } = useSnapshot();
  const [view, setViewState] = useState<MainView>(() => readMainFromLocation());
  const [nodeId, setNodeId] = useState<string | null>(null);

  useEffect(() => {
    const onPop = () => setViewState(readMainFromLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const setView = useCallback((next: MainView) => {
    setViewState(next);
    writeMainToLocation(next);
  }, []);

  const reportId =
    view.kind === "report" ? view.id || snapshot?.reports[0]?.id : undefined;

  useEffect(() => {
    if (view.kind !== "report" || view.id || !reportId) return;
    const next: MainView = { kind: "report", id: reportId };
    setViewState(next);
    writeMainToLocation(next, "replace");
  }, [view, reportId]);

  if (!snapshot) {
    if (fault) return <FaultPanel fault={fault} />;
    return (
      <div className="flex h-svh flex-col gap-4 bg-background p-6">
        <div className="h-4 w-40 animate-pulse rounded-md bg-zinc-800" />
        <div className="grid flex-1 grid-cols-[16rem_1fr] gap-4">
          <div className="flex flex-col gap-2">
            <div className="h-8 animate-pulse rounded-md bg-zinc-800" />
            <div className="h-8 animate-pulse rounded-md bg-zinc-800" />
            <div className="h-8 animate-pulse rounded-md bg-zinc-800" />
          </div>
          <div className="min-h-0 rounded-md border border-border bg-zinc-950/40">
            <div className="h-full animate-pulse bg-zinc-900/80" />
          </div>
        </div>
        {error ? <p className="text-sm text-muted-foreground">Waiting for CLI server… ({error})</p> : null}
      </div>
    );
  }

  return (
    <TooltipProvider>
    <ShotHost>
      <div className="flex h-svh flex-col overflow-hidden bg-background text-foreground print:h-auto print:overflow-visible">
        {snapshot.notice ? <NoticeBanner notice={snapshot.notice} /> : null}
        <div className="flex min-h-0 flex-1 overflow-hidden print:overflow-visible">
        <Sidebar
          snapshot={snapshot}
          view={view.kind === "report" && !view.id && reportId ? { kind: "report", id: reportId } : view}
          onView={setView}
        />
        <main className="min-w-0 flex-1 print:overflow-visible">
          {view.kind === "map" ? <MapCanvas snapshot={snapshot} onSelectNode={setNodeId} /> : null}
          {view.kind === "config" ? <ConfigPanel leash={snapshot.leash} /> : null}
          {view.kind === "run" ? (
            <RunPanel key={view.id} run={snapshot.runs.find((run) => run.id === view.id)} />
          ) : null}
          {view.kind === "report" ? (
            reportId ? (
              <ReportMarkdown reportId={reportId} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No reports yet. Run <code className="mx-1">clickmonkey report</code>.
              </div>
            )
          ) : null}
        </main>
        <NodeSheet
          snapshot={snapshot}
          nodeId={nodeId}
          onOpenChange={(open) => {
            if (!open) setNodeId(null);
          }}
          onOpenRun={(runId) => {
            setNodeId(null);
            setView({ kind: "run", id: runId });
          }}
        />
        </div>
      </div>
    </ShotHost>
    </TooltipProvider>
  );
}
