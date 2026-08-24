import { FileText, Map as MapIcon, Settings2 } from "lucide-react";
import type { ReactNode } from "react";
import type { UiRun, UiSnapshot } from "@schema/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { MainView } from "@/lib/view";
import { monkeyOfBrain } from "@schema/fog";
import { cn, runHue } from "@/lib/utils";

function navActive(view: MainView, target: MainView): boolean {
  if (view.kind !== target.kind) return false;
  if (view.kind === "run" && target.kind === "run") return view.id === target.id;
  if (view.kind === "report" && target.kind === "report") return view.id === target.id;
  return true;
}

function NavButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn(
        "h-8 w-full justify-start gap-2 px-2 font-normal",
        active && "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
    >
      {children}
    </Button>
  );
}

function RunRow({ run, active, onClick }: { run: UiRun; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-sidebar-accent",
        active && "bg-sidebar-accent",
      )}
    >
      <span
        className="mt-1 size-2.5 shrink-0 rounded-full"
        style={run.live ? { backgroundColor: runHue(run.hue) } : undefined}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{run.name}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={run.live ? "text-emerald-400" : undefined}>{run.live ? "live" : "idle"}</span>
          {run.brain ? (
            <>
              <span aria-hidden>·</span>
              <span className="truncate">{monkeyOfBrain(run.brain) ?? run.brain}</span>
            </>
          ) : null}
          <span aria-hidden>·</span>
          <span>
            {run.findingCount} finding{run.findingCount === 1 ? "" : "s"}
          </span>
        </span>
        {run.outline?.now ? (
          <span className="mt-0.5 block truncate text-[11px] text-zinc-400">{run.outline.now}</span>
        ) : null}
      </span>
    </button>
  );
}

export function Sidebar({
  snapshot,
  view,
  onView,
}: {
  snapshot: UiSnapshot;
  view: MainView;
  onView: (view: MainView) => void;
}) {
  const reports = snapshot.reports ?? [];

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground print:hidden">
      <div className="px-3 py-3">
        <div className="text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">ClickMonkey</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{snapshot.leash.url}</div>
      </div>
      <div className="flex flex-col gap-0.5 px-2">
        <NavButton active={navActive(view, { kind: "config" })} onClick={() => onView({ kind: "config" })}>
          <Settings2 />
          Config
        </NavButton>
        <NavButton active={navActive(view, { kind: "map" })} onClick={() => onView({ kind: "map" })}>
          <MapIcon />
          Map
        </NavButton>
      </div>
      <Separator className="my-2" />
      <div className="px-3 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">Runs</div>
      <ScrollArea className="min-h-0 flex-1 px-2">
        {snapshot.runs.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">No runs yet.</p>
        ) : (
          <div className="flex flex-col gap-0.5 pb-2">
            {snapshot.runs.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                active={navActive(view, { kind: "run", id: run.id })}
                onClick={() => onView({ kind: "run", id: run.id })}
              />
            ))}
          </div>
        )}
      </ScrollArea>
      {reports.length > 0 ? (
        <>
          <Separator />
          <div className="px-2 py-2">
            <div className="px-1 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              Reports
            </div>
            <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
              {reports.map((report) => (
                <NavButton
                  key={report.id}
                  active={navActive(view, { kind: "report", id: report.id })}
                  onClick={() => onView({ kind: "report", id: report.id })}
                >
                  <FileText />
                  <span className="min-w-0 flex-1 truncate">{report.title}</span>
                  <Badge variant="secondary" className="ml-auto shrink-0">
                    {report.findingCount}
                  </Badge>
                </NavButton>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </aside>
  );
}
