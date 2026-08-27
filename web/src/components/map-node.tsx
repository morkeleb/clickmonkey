import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { FOG_JOBS, FOG_JOB_MARK, MONKEY_MARK, fogHeatColor, fogOf, landAgeLabel } from "@/lib/fog";
import type { GraphNodeData } from "@/lib/layout";
import { cn, runHue } from "@/lib/utils";

type GraphNode = Node<GraphNodeData, "graph">;

function JobHeat({ data }: { data: GraphNodeData }) {
  const tip = FOG_JOBS.map((job) => `${job}: ${landAgeLabel(data.jobFog?.[job])}`).join(" · ");
  return (
    <div className="flex gap-0.5" title={tip} aria-label={tip}>
      {FOG_JOBS.map((job) => (
        <span
          key={job}
          className="flex size-3 items-center justify-center rounded-full text-[7px] leading-none font-bold text-white uppercase"
          style={{ backgroundColor: fogHeatColor(data.jobFog?.[job]) }}
        >
          {FOG_JOB_MARK[job]}
        </span>
      ))}
    </div>
  );
}

export function MapNode({ data, selected }: NodeProps<GraphNode>) {
  const dialog = data.kind === "dialog";
  const sized = data.cardWidth != null && data.cardHeight != null;
  const fog = dialog ? 0 : fogOf(data.fogAt);
  const haze = fog >= 0.4 ? fog * 0.55 : 0;
  const heatTip = !dialog
    ? [landAgeLabel(data.fogAt), ...FOG_JOBS.map((job) => `${job}: ${landAgeLabel(data.jobFog?.[job])}`)].join(
        " · ",
      )
    : undefined;
  return (
    <div className="relative h-full w-full overflow-visible">
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-zinc-600 !bg-zinc-500" />
      <div
        className="relative overflow-visible"
        style={sized ? { width: data.cardWidth, height: data.cardHeight } : { width: "100%", height: "100%" }}
      >
        {data.rings.map((ring, i) => (
          <span
            key={`${ring.name}-${i}`}
            className="pointer-events-none absolute animate-pulse rounded-lg"
            style={{
              inset: -(3 + i * 4),
              boxShadow: `0 0 0 2px ${runHue(ring.hue)}`,
            }}
            aria-hidden
          />
        ))}
        <div
          className={cn(
            "relative flex h-full w-full items-center gap-2 rounded-lg border px-2.5 py-1.5",
            dialog
              ? "border-zinc-800 bg-zinc-900/90 text-zinc-400"
              : "border-zinc-700 bg-zinc-800 text-zinc-100",
            selected && "border-zinc-200",
          )}
          title={heatTip}
        >
          {haze > 0 ? (
            <span
              className="pointer-events-none absolute inset-0 z-0 rounded-lg bg-zinc-950"
              style={{ opacity: haze }}
              aria-hidden
            />
          ) : null}
          <div className="relative z-10 min-w-0 flex-1">
            {data.kicker && !data.section ? (
              <div className="truncate text-[10px] tracking-wide text-zinc-500 uppercase">{data.kicker}</div>
            ) : null}
            <div className={cn("truncate font-medium leading-5", dialog ? "text-[11px]" : "text-[13px]")}>{data.title}</div>
            {data.blurb ? (
              <div className="truncate text-[10px] leading-4 text-zinc-400" title={data.blurb}>
                {data.blurb}
              </div>
            ) : null}
            {data.entry ? <div className="text-[10px] tracking-wide text-zinc-500 uppercase">entry</div> : null}
            {dialog ? <div className="text-[10px] leading-4 text-zinc-500">dialog</div> : null}
          </div>
          {(data.red > 0 || data.yellow > 0 || data.rings.length > 0 || !dialog) && (
            <div className="relative z-10 flex shrink-0 flex-col items-end gap-1">
              {!dialog ? <JobHeat data={data} /> : null}
              <div className="flex gap-0.5">
                {data.red > 0 ? (
                  <span className="min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] leading-4 font-semibold text-white">
                    {data.red}
                  </span>
                ) : null}
                {data.yellow > 0 ? (
                  <span className="min-w-4 rounded-full bg-amber-400 px-1 text-center text-[10px] leading-4 font-semibold text-zinc-900">
                    {data.yellow}
                  </span>
                ) : null}
              </div>
              {data.rings.length > 0 ? (
                <div className="flex gap-0.5">
                  {data.rings.map((ring) => {
                    const mark = ring.monkey ? MONKEY_MARK[ring.monkey] : undefined;
                    const tip = ring.monkey ? `${ring.monkey} · ${ring.name}` : ring.name;
                    return (
                      <span
                        key={ring.name}
                        title={tip}
                        className="flex size-3 items-center justify-center rounded-full border border-zinc-950 text-[7px] leading-none font-bold text-white uppercase"
                        style={{ backgroundColor: runHue(ring.hue) }}
                      >
                        {mark ?? ""}
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-zinc-600 !bg-zinc-500" />
    </div>
  );
}
