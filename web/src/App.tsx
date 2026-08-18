import { useCallback, useEffect, useState } from "react";
import { ConfigPanel } from "@/components/config-panel";
import { MapCanvas } from "@/components/map-canvas";
import { NodeSheet } from "@/components/node-sheet";
import { ReportMarkdown } from "@/components/report-markdown";
import { RunPanel } from "@/components/run-panel";
import { Sidebar } from "@/components/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSnapshot } from "@/lib/api";
import { readMainFromLocation, writeMainToLocation, type MainView } from "@/lib/view";

export function App() {
  const { snapshot, error } = useSnapshot();
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

  if (!snapshot) {
    return (
      <div className="flex h-svh items-center justify-center bg-background text-sm text-muted-foreground">
        {error ? `Waiting for CLI server… (${error})` : "Connecting…"}
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex h-svh overflow-hidden bg-background text-foreground">
        <Sidebar snapshot={snapshot} view={view} onView={setView} />
        <main className="min-w-0 flex-1">
          {view.kind === "map" ? <MapCanvas snapshot={snapshot} onSelectNode={setNodeId} /> : null}
          {view.kind === "config" ? <ConfigPanel leash={snapshot.leash} /> : null}
          {view.kind === "run" ? <RunPanel run={snapshot.runs.find((run) => run.id === view.id)} /> : null}
          {view.kind === "report" ? <ReportMarkdown markdown={snapshot.reportMarkdown} /> : null}
        </main>
        <NodeSheet
          snapshot={snapshot}
          nodeId={nodeId}
          onOpenChange={(open) => {
            if (!open) setNodeId(null);
          }}
        />
      </div>
    </TooltipProvider>
  );
}
