import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { UiSnapshot } from "@schema/ui";
import { MapNode } from "@/components/map-node";
import { MapSection } from "@/components/map-section";
import { defaultExpanded, layoutGraph, type GraphFlowNode } from "@/lib/layout";
import "@xyflow/react/dist/style.css";

const nodeTypes: NodeTypes = { graph: MapNode, section: MapSection };

function MapCanvasInner({
  snapshot,
  onSelectNode,
}: {
  snapshot: UiSnapshot;
  onSelectNode: (id: string) => void;
}) {
  const { fitView } = useReactFlow();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(snapshot.graph, snapshot.runs));

  useEffect(() => {
    setExpanded((prev) => {
      const next = defaultExpanded(snapshot.graph, snapshot.runs);
      for (const key of prev) next.add(key);
      return next;
    });
  }, [snapshot.graph, snapshot.runs]);

  const laidOut = useMemo(
    () => layoutGraph(snapshot.graph, snapshot.runs, { expanded, selectedId, query }),
    [snapshot.graph, snapshot.runs, expanded, selectedId, query],
  );
  const [nodes, setNodes] = useState<GraphFlowNode[]>(laidOut.nodes);
  const [edges, setEdges] = useState<Edge[]>(laidOut.edges);
  const signature = useMemo(
    () =>
      `${laidOut.nodes.map((n) => n.id).join(",")}|${[...expanded].sort().join(",")}|${query}|${selectedId ?? ""}`,
    [laidOut, expanded, query, selectedId],
  );

  useEffect(() => {
    setNodes((prev) => {
      const selected = new Set(prev.filter((n) => n.selected).map((n) => n.id));
      return laidOut.nodes.map((node) => (selected.has(node.id) ? { ...node, selected: true } : node));
    });
    setEdges(laidOut.edges);
  }, [laidOut]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: 0.16 });
    });
    return () => cancelAnimationFrame(frame);
  }, [fitView, signature]);

  const onNodesChange = useCallback((changes: NodeChange<GraphFlowNode>[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds));
  }, []);

  const onNodeClick = useCallback(
    (_event: unknown, node: GraphFlowNode) => {
      if (node.type === "section" && node.data.section) {
        const key = node.data.section;
        setExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          return next;
        });
        return;
      }
      setSelectedId(node.id);
      onSelectNode(node.id);
    },
    [onSelectNode],
  );

  if (laidOut.nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-zinc-950 text-sm text-zinc-500">
        No pages on the map yet.
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      fitView
      colorMode="dark"
      minZoom={0.12}
      maxZoom={1.75}
      proOptions={{ hideAttribution: true }}
      nodesConnectable={false}
      nodesDraggable={false}
      edgesReconnectable={false}
      elementsSelectable
    >
      <Background color="#3f3f46" gap={20} size={1} />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        maskColor="rgba(0,0,0,0.7)"
        nodeColor={(node) => (node.type === "section" ? "#3f3f46" : "#52525b")}
        className="!bg-zinc-950 !border-zinc-800"
      />
      <Panel position="top-left" className="m-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter pages…"
          className="h-8 w-56 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-zinc-400"
        />
      </Panel>
      <Panel position="top-right" className="m-3">
        <div className="rounded-md border border-zinc-700 bg-zinc-900/90 px-2.5 py-1.5 text-[10px] leading-4 text-zinc-400">
          <div className="font-medium text-zinc-300">fog (green recent · red hungry)</div>
          <div>m map · u unleash · n nasty</div>
          <div className="mt-1 font-medium text-zinc-300">live (colored letter)</div>
          <div>m map · u unleash · n nasty · e explore · c mcp</div>
        </div>
      </Panel>
    </ReactFlow>
  );
}

export function MapCanvas({
  snapshot,
  onSelectNode,
}: {
  snapshot: UiSnapshot;
  onSelectNode: (id: string) => void;
}) {
  return (
    <div className="h-full w-full bg-zinc-950">
      <ReactFlowProvider>
        <MapCanvasInner snapshot={snapshot} onSelectNode={onSelectNode} />
      </ReactFlowProvider>
    </div>
  );
}
