import { useMemo, useState } from "react";
import { explorePlanItemMark, formatExplorePlanItemCoverage, type UiRun, type UiRunDetail, type UiRunFinding, type UiRunStep } from "@schema/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Shot, ShotPreview } from "@/components/shot";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { clockOf, shortHref, useRunDetail } from "@/lib/run-detail";
import { cn, runHue } from "@/lib/utils";

type Filter = "all" | "failed";

function severityVariant(severity: string | undefined): "destructive" | "secondary" | "outline" {
  if (severity === "critical" || severity === "major") return "destructive";
  if (severity === "minor") return "secondary";
  return "outline";
}

function HopLine({ from, to }: { from: string; to: string }) {
  return (
    <div className="font-mono text-[11px] break-all text-muted-foreground">
      <span className="text-zinc-500">{shortHref(from)}</span>
      <span className="mx-1 text-zinc-600">→</span>
      <span>{shortHref(to)}</span>
    </div>
  );
}

function StepRow({
  step,
  onOpenShot,
}: {
  step: UiRunStep;
  onOpenShot: (url: string) => void;
}) {
  const bounced = step.finding === "fenceViolation";
  const failed = step.ok === false && !bounced;
  return (
    <li className="relative">
      <span
        className={cn(
          "absolute top-1.5 -left-[31px] size-2.5 rounded-full",
          failed ? "bg-red-500" : bounced ? "bg-zinc-500" : step.ok === true ? "bg-emerald-500" : "bg-zinc-500 animate-pulse",
        )}
        aria-hidden
      />
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-mono text-[11px] text-zinc-500">{clockOf(step.ts)}</span>
        {step.phase ? (
          <span className="text-[10px] tracking-wide text-zinc-500 uppercase">{step.phase}</span>
        ) : null}
        {step.pageId ? <span className="font-mono text-[11px] text-zinc-400">{step.pageId}</span> : null}
        {step.ms !== undefined ? <span className="text-[11px] text-zinc-500">{step.ms}ms</span> : null}
      </div>
      <div className={cn("mt-0.5 font-mono text-sm break-all", failed && "text-red-300")}>{step.line}</div>
      {step.note ? <p className="mt-0.5 text-xs text-zinc-400">{step.note}</p> : null}
      {step.good ? <p className="mt-0.5 text-xs text-zinc-500">{step.good}</p> : null}
      {step.sight ? <p className="mt-0.5 text-xs text-zinc-400">Sight: {step.sight}</p> : null}
      {step.hops?.map((hop, i) => (
        <HopLine key={`${hop.from}-${hop.to}-${i}`} from={hop.from} to={hop.to} />
      ))}
      {bounced && !step.findingMessage ? (
        <div className="mt-1 text-[11px] text-zinc-500">bounced off the fence</div>
      ) : null}
      {step.findingMessage && !bounced ? (
        <div className="mt-2 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={severityVariant(step.findingSeverity)}>{step.finding ?? "finding"}</Badge>
            {step.findingSeverity ? (
              <span className="text-[11px] text-muted-foreground">{step.findingSeverity}</span>
            ) : null}
          </div>
          <p className="mt-1 text-xs break-all text-zinc-300">{step.findingMessage}</p>
          {step.screenshotUrl ? (
            <Shot url={step.screenshotUrl} alt={step.findingMessage} onOpen={onOpenShot} />
          ) : null}
        </div>
      ) : step.screenshotUrl ? (
        <Shot url={step.screenshotUrl} alt={step.line} onOpen={onOpenShot} />
      ) : null}
    </li>
  );
}

function FindingCard({
  finding,
  onOpenShot,
}: {
  finding: UiRunFinding;
  onOpenShot: (url: string) => void;
}) {
  return (
    <li className="rounded-lg border border-border bg-card/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={severityVariant(finding.severity)}>{finding.kind}</Badge>
        <span className="text-[11px] text-muted-foreground">step {finding.stepIndex}</span>
        {finding.widgetRef ? (
          <code className="font-mono text-[11px] text-zinc-400">{finding.widgetRef}</code>
        ) : null}
      </div>
      <p className="mt-2 text-sm break-all">{finding.message}</p>
      {finding.url ? <p className="mt-1 font-mono text-[11px] break-all text-muted-foreground">{shortHref(finding.url)}</p> : null}
      {finding.screenshotUrl ? (
        <Shot url={finding.screenshotUrl} alt={finding.message} onOpen={onOpenShot} />
      ) : null}
    </li>
  );
}

function RunBody({ detail }: { detail: UiRunDetail }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [preview, setPreview] = useState<string | null>(null);
  const steps = useMemo(
    () =>
      filter === "failed"
        ? detail.steps.filter((s) => s.ok === false && s.finding !== "fenceViolation")
        : detail.steps,
    [detail.steps, filter],
  );
  const failed = detail.steps.filter((s) => s.ok === false && s.finding !== "fenceViolation").length;

  return (
    <>
      <Tabs defaultValue="timeline" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-3">
          <TabsList>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="findings">Findings {detail.findingCount}</TabsTrigger>
          </TabsList>
          <div className="flex gap-1">
            <Button type="button" size="sm" variant={filter === "all" ? "secondary" : "ghost"} onClick={() => setFilter("all")}>
              All {detail.steps.length}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={filter === "failed" ? "secondary" : "ghost"}
              onClick={() => setFilter("failed")}
            >
              Failed {failed}
            </Button>
          </div>
        </div>
        <TabsContent value="timeline" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            <ol className="relative ml-6 flex flex-col gap-5 border-l border-zinc-800 py-2 pr-6 pl-6">
              {detail.boot ? (
                <li className="relative">
                  <span className="absolute top-1.5 -left-[31px] size-2.5 rounded-full bg-zinc-500" aria-hidden />
                  <div className="flex gap-2">
                    <span className="font-mono text-[11px] text-zinc-500">{clockOf(detail.boot.ts)}</span>
                    <span className="text-[10px] tracking-wide text-zinc-500 uppercase">boot</span>
                  </div>
                  {detail.boot.hops.map((hop, i) => (
                    <HopLine key={`${hop.to}-${i}`} from={hop.from} to={hop.to} />
                  ))}
                </li>
              ) : null}
              {steps.map((step) => (
                <StepRow key={`${step.index}-${step.ts}`} step={step} onOpenShot={setPreview} />
              ))}
              {steps.length === 0 ? (
                <li className="text-sm text-muted-foreground">
                  {detail.steps.length === 0 ? "No steps recorded yet." : "No failed steps."}
                </li>
              ) : null}
            </ol>
          </ScrollArea>
        </TabsContent>
        <TabsContent value="findings" className="min-h-0 flex-1">
          <ScrollArea className="h-full">
            {detail.findings.length === 0 ? (
              <p className="px-6 py-6 text-sm text-muted-foreground">No findings in this run.</p>
            ) : (
              <ul className="grid gap-3 px-6 py-4 lg:grid-cols-2">
                {detail.findings.map((finding) => (
                  <FindingCard key={finding.id} finding={finding} onOpenShot={setPreview} />
                ))}
              </ul>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
      <ShotPreview
        url={preview}
        alt="Step screenshot"
        description="Captured when the step finished."
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      />
    </>
  );
}

function OutlineCard({ outline }: { outline: NonNullable<UiRunDetail["outline"]> }) {
  return (
    <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2">
      <div className="text-[10px] tracking-wide text-zinc-500 uppercase">Explore</div>
      <p className="mt-1 text-sm text-zinc-200">{outline.charter}</p>
      {outline.now ? (
        <p className="mt-2 text-sm text-zinc-300">
          <span className="text-[10px] tracking-wide text-zinc-500 uppercase">Now </span>
          {outline.now}
        </p>
      ) : null}
      {outline.plan ? (
        <div className="mt-2">
          <div className="text-[10px] tracking-wide text-zinc-500 uppercase">Plan</div>
          <p className="mt-0.5 text-xs text-zinc-300">{outline.plan.goal}</p>
          <ol className="mt-1 space-y-0.5 text-xs text-zinc-400">
            {outline.plan.items.map((item) => {
              return (
                <li key={item.id} className={item.status === "now" ? "text-zinc-200" : undefined}>
                  <span className="font-mono text-zinc-500">[{explorePlanItemMark(item.status)}]</span>{" "}
                  {item.title}
                  {item.page ? <span className="text-zinc-600"> · {item.page}</span> : null}
                  <span className="text-zinc-600"> — {formatExplorePlanItemCoverage(item)}</span>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

export function RunPanel({ run }: { run: UiRun | undefined }) {
  const { detail, error } = useRunDetail(run?.id, { live: run?.live });
  if (!run) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Run not in snapshot.</div>
    );
  }
  const steps = detail?.steps ?? run.steps ?? [];
  const shown: UiRunDetail = {
    schemaVersion: 1,
    id: run.id,
    name: run.name,
    hue: run.hue,
    live: run.live,
    pageId: detail?.pageId ?? run.pageId,
    brain: detail?.brain ?? run.brain,
    findingCount: detail?.findingCount ?? run.findingCount,
    startedAt: detail?.startedAt,
    outline: detail?.outline ?? run.outline,
    boot: detail?.boot ?? run.boot,
    steps,
    findings:
      detail?.findings ??
      steps
        .filter((step) => step.finding && step.finding !== "fenceViolation")
        .map((step) => ({
          id: step.findingId ?? `fnd_${step.index}_${step.finding}`,
          kind: step.finding!,
          severity: step.findingSeverity ?? "major",
          message: step.findingMessage ?? step.finding!,
          stepIndex: step.index,
          screenshotUrl: step.screenshotUrl,
        })),
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-6 pt-6 pb-3">
        <div className="flex items-start gap-3">
          <span
            className="mt-1.5 size-3 shrink-0 rounded-full"
            style={run.live ? { backgroundColor: runHue(run.hue) } : undefined}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-lg font-semibold">{run.name}</h1>
              <Badge variant={run.live ? "default" : "secondary"}>{run.live ? "live" : "idle"}</Badge>
              {error ? <span className="text-xs text-red-400">{error}</span> : null}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>
                brain <span className="text-foreground">{run.brain ?? "—"}</span>
              </span>
              <span>
                page <span className="font-mono text-foreground">{shown.pageId ?? "—"}</span>
              </span>
              <span>
                <span className="text-foreground">{shown.steps.length}</span> steps
              </span>
              <span>
                <span className="text-foreground">{shown.findingCount}</span> finding
                {shown.findingCount === 1 ? "" : "s"}
              </span>
              <span className="font-mono text-xs">{run.id}</span>
            </div>
          </div>
        </div>
        {shown.outline ? <OutlineCard outline={shown.outline} /> : null}
      </div>
      <Separator />
      <RunBody detail={shown} />
    </div>
  );
}
