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
  type Viewport,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UiSnapshot } from "@schema/ui";
import { DOCS_MAP } from "@schema/site";
import { MapNode } from "@/components/map-node";
import { MapSection } from "@/components/map-section";
import { defaultExpanded, layoutGraph, mergeExpanded, sameFlowNodes, type GraphFlowNode } from "@/lib/layout";
import "@xyflow/react/dist/style.css";

const nodeTypes: NodeTypes = { graph: MapNode, section: MapSection };
const START_VIEW: Viewport = { x: 80, y: 80, zoom: 0.95 };

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
  const [viewport, setViewport] = useState<Viewport>(START_VIEW);
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(snapshot.graph, snapshot.runs));
  const fitted = useRef(false);

  useEffect(() => {
    setExpanded((prev) => mergeExpanded(prev, snapshot.graph, snapshot.runs));
  }, [snapshot.graph, snapshot.runs]);

  const laidOut = useMemo(
    () => layoutGraph(snapshot.graph, snapshot.runs, { expanded, selectedId, query }),
    [snapshot.graph, snapshot.runs, expanded, selectedId, query],
  );
  const [nodes, setNodes] = useState<GraphFlowNode[]>(laidOut.nodes);
  const [edges, setEdges] = useState<Edge[]>(laidOut.edges);
  useEffect(() => {
    setNodes((prev) => {
      const selected = new Set(prev.filter((n) => n.selected).map((n) => n.id));
      const next = laidOut.nodes.map((node) => (selected.has(node.id) ? { ...node, selected: true } : node));
      return sameFlowNodes(prev, next) ? prev : next;
    });
    setEdges((prev) => {
      if (
        prev.length === laidOut.edges.length &&
        prev.every((e, i) => e.id === laidOut.edges[i]?.id && e.hidden === laidOut.edges[i]?.hidden)
      ) {
        return prev;
      }
      return laidOut.edges;
    });
  }, [laidOut]);

  useEffect(() => {
    if (laidOut.nodes.length === 0) return;
    if (query) {
      const hits = laidOut.nodes.filter((n) => !n.hidden && n.type !== "section");
      if (hits.length === 0) return;
      const frame = requestAnimationFrame(() => {
        void fitView({ nodes: hits, padding: 0.3, maxZoom: 1 });
      });
      return () => cancelAnimationFrame(frame);
    }
    if (fitted.current) return;
    const live = snapshot.runs.filter((r) => r.live && r.pageId).map((r) => r.pageId!);
    const entries = snapshot.graph.nodes.filter((n) => n.kind === "page" && n.entry).map((n) => n.id);
    const focus = new Set(live.length > 0 ? live : entries);
    const targets = laidOut.nodes.filter((n) => focus.has(n.id) || (n.data.pageId && focus.has(n.data.pageId)));
    if (targets.length === 0) return;
    fitted.current = true;
    const frame = requestAnimationFrame(() => {
      void fitView({ nodes: targets, padding: 0.45, maxZoom: 1, minZoom: 0.75 });
    });
    return () => cancelAnimationFrame(frame);
  }, [fitView, query, laidOut.nodes.length]);

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
      colorMode="dark"
      minZoom={0.35}
      maxZoom={1.75}
      viewport={viewport}
      onViewportChange={setViewport}
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
        <a
          href={DOCS_MAP}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
        >
          How to read the map
        </a>
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
