import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { GraphNodeData } from "@/lib/layout";
import { cn, runHue } from "@/lib/utils";

type SectionNode = Node<GraphNodeData, "section">;

export function MapSection({ data, selected }: NodeProps<SectionNode>) {
  const Chevron = data.collapsed ? ChevronRight : ChevronDown;
  return (
    <div className="relative h-full w-full overflow-visible">
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-zinc-600 !bg-zinc-500" />
      {data.rings.map((ring, i) => (
        <span
          key={`${ring.name}-${i}`}
          className="pointer-events-none absolute animate-pulse rounded-xl"
          style={{
            inset: -(3 + i * 4),
            boxShadow: `0 0 0 2px ${runHue(ring.hue)}`,
          }}
          aria-hidden
        />
      ))}
      <div
        className={cn(
          "flex h-full w-full flex-col rounded-xl border bg-zinc-900/80",
          selected ? "border-zinc-400" : "border-zinc-700",
        )}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 px-3">
          <Chevron className="size-3.5 shrink-0 text-zinc-500" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-zinc-100">{data.title}</div>
            <div className="text-[11px] text-zinc-500">
              {data.count ?? 0} page{(data.count ?? 0) === 1 ? "" : "s"}
              {data.collapsed ? " · collapsed" : ""}
            </div>
          </div>
          <div className="flex shrink-0 gap-0.5">
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
            {data.rings.map((ring) => (
              <span
                key={ring.name}
                title={ring.name}
                className="size-2.5 self-center rounded-full border border-zinc-950"
                style={{ backgroundColor: runHue(ring.hue) }}
              />
            ))}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-zinc-600 !bg-zinc-500" />
    </div>
  );
}
