"use client";

// PROTOTYPE, never merge. The workflow as a React Flow graph, laid out top to bottom by dagre.
// Boxes can't be dragged: the layout is always automatic. Variants A and B draw this.
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import {
  BaseEdge,
  Background,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type FitViewOptions,
} from "@xyflow/react";
import { CircleCheck, Octagon, Plus } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "cn";
import type { ListId, NewStepKind, ViewPath, ViewStep, ViewTree } from "./model";
import {
  AddStepMenu,
  ChangeBadge,
  MoveButtons,
  PathRunSummary,
  ReviewBadge,
  RiskBadge,
  StepIcon,
  TriggerIcon,
  changeClasses,
} from "./parts";
import { usePrototype } from "./state";
import { useIsNarrow } from "./use-is-narrow";

type Insert = { listId: ListId; index: number };

type TriggerData = { kind: "trigger"; empty: boolean };
type PlaceholderData = { kind: "placeholder" };
type StepData = { kind: "step"; view: ViewStep };
type PathData = { kind: "path"; path: ViewPath; mode: "first" | "every" };
type EndData = {
  kind: "end";
  label: string;
  run: "taken" | "skipped" | null;
  change: ViewStep["change"];
};
type NodeData = TriggerData | PlaceholderData | StepData | PathData | EndData;
type GraphNode = Node<NodeData>;

type EdgeData = { insert: Insert | null; run: "taken" | "skipped" | null; removed: boolean };
type GraphEdge = Edge<EdgeData>;

const STEP_WIDTH = 272;
const PATH_WIDTH = 248;

// Sizes are fixed per kind so dagre can lay out before anything renders; text is clamped to fit.
function stepHeight(view: ViewStep): number {
  if (view.type === "approval") return 72;
  if (view.type === "branch") return 80;
  const badges = view.risk !== null;
  return (badges ? 100 : 78) + (view.before === null ? 0 : 18);
}

function pathHeight(path: ViewPath): number {
  let height = 66 + (path.before === null ? 0 : 18);
  const run = path.run;
  if (run !== null) {
    height += 20;
    if (run.status === "taken" || run.status === "failed") height += run.checks.length * 32;
  }
  return height;
}

// Building the graph -----------------------------------------------------------------------------

function buildGraph(tree: ViewTree, editable: boolean, trySummary: boolean) {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const order: { left: string; right: string }[] = [];
  const size = new Map<string, { width: number; height: number }>();

  const add = (node: GraphNode, width: number, height: number) => {
    nodes.push(node);
    size.set(node.id, { width, height });
  };
  const connect = (
    source: string,
    target: string,
    insert: Insert | null,
    run: "taken" | "skipped" | null,
    removed = false,
  ) => {
    edges.push({
      id: `${source}->${target}`,
      source,
      target,
      type: "plus",
      data: { insert: editable && !removed ? insert : null, run, removed },
    });
  };

  add(
    {
      id: "trigger",
      type: "trigger",
      position: { x: 0, y: 0 },
      data: { kind: "trigger", empty: tree.empty },
    },
    STEP_WIDTH,
    76,
  );
  if (tree.empty) {
    add(
      {
        id: "placeholder",
        type: "placeholder",
        position: { x: 0, y: 0 },
        data: { kind: "placeholder" },
      },
      STEP_WIDTH,
      120,
    );
    connect("trigger", "placeholder", null, null);
    return { nodes, edges, order, size };
  }

  const nodeId = (view: ViewStep) => (view.change === "removed" ? `removed:${view.id}` : view.id);

  const list = (
    steps: ViewStep[],
    from: string,
    start: Insert,
    fromRun: "taken" | "skipped" | null,
    endLabel: string,
  ) => {
    let prev = from;
    let prevInsert: Insert | null = start;
    let prevRun = fromRun;
    for (const view of steps) {
      const id = nodeId(view);
      add(
        { id, type: "step", position: { x: 0, y: 0 }, data: { kind: "step", view } },
        STEP_WIDTH,
        stepHeight(view),
      );
      connect(prev, id, prevInsert, edgeRun(prevRun, view.run), view.change === "removed");
      prev = id;
      // A "+" under a review goes after its draft; under a removed step there is none.
      prevInsert = view.change === "removed" ? null : view.insertAfter;
      prevRun = view.run;
      if (view.branch !== null) {
        let left: string | null = null;
        for (const path of view.branch.paths) {
          const pathId = `path:${path.change === "removed" ? "removed:" : ""}${path.id}`;
          add(
            {
              id: pathId,
              type: "path",
              position: { x: 0, y: 0 },
              data: { kind: "path", path, mode: view.branch.mode },
            },
            PATH_WIDTH,
            pathHeight(path),
          );
          const pathRun =
            path.run === null ? null : path.run.status === "taken" ? "taken" : "skipped";
          connect(id, pathId, null, edgeRun(view.run, pathRun), path.change === "removed");
          if (left !== null) order.push({ left, right: pathId });
          left = pathId;
          list(
            path.steps,
            pathId,
            { listId: path.listId, index: 0 },
            pathRun,
            path.otherwise && path.steps.length === 0 ? "Stops here" : "End",
          );
        }
        return;
      }
    }
    const endId = `end:${from}`;
    const last = steps.at(-1);
    add(
      {
        id: endId,
        type: "end",
        position: { x: 0, y: 0 },
        data: {
          kind: "end",
          label: endLabel,
          run: prevRun,
          change: last?.change === "removed" ? null : null,
        },
      },
      endLabel === "Stops here" ? 112 : 64,
      28,
    );
    connect(prev, endId, prevInsert, edgeRun(prevRun, prevRun));
  };

  list(tree.steps, "trigger", { listId: "root", index: 0 }, trySummary ? "taken" : null, "End");
  return { nodes, edges, order, size };
}

function edgeRun(
  from: "taken" | "skipped" | null,
  to: "taken" | "skipped" | null,
): "taken" | "skipped" | null {
  if (from === null || to === null) return null;
  return from === "taken" && to === "taken" ? "taken" : "skipped";
}

function layout(graph: ReturnType<typeof buildGraph>): GraphNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "TB",
    nodesep: 28,
    ranksep: 40,
    marginx: 24,
    marginy: 24,
    rankalign: "top",
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const node of graph.nodes)
    g.setNode(node.id, graph.size.get(node.id) ?? { width: 200, height: 80 });
  for (const edge of graph.edges) g.setEdge(edge.source, edge.target);
  // Paths keep their order left to right: for first match, the order is the rule.
  dagre.layout(g, { constraints: graph.order });
  return graph.nodes.map((node) => {
    const { x, y, width, height } = g.node(node.id);
    return {
      ...node,
      position: { x: x - width / 2, y: y - height / 2 },
      width,
      height,
      draggable: false,
      connectable: false,
    };
  });
}

// Nodes -----------------------------------------------------------------------------------------

const hidden = "!h-1 !min-h-0 !w-1 !min-w-0 !border-0 !bg-transparent";

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Top} className={hidden} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} className={hidden} isConnectable={false} />
    </>
  );
}

function useSelected(kind: "step" | "path" | "trigger", id: string): boolean {
  const { selection } = usePrototype();
  if (selection === null) return false;
  if (selection.kind === "trigger") return kind === "trigger";
  return selection.kind === kind && selection.id === id;
}

function TriggerNode({ data }: NodeProps<Node<TriggerData>>) {
  const selected = useSelected("trigger", "trigger");
  const { tryItOn } = usePrototype();
  return (
    <div
      className={cn(
        "flex h-full cursor-pointer flex-col gap-0.5 rounded-lg border bg-card px-3 py-2 shadow-sm",
        selected && "ring-2 ring-primary",
        tryItOn && "border-emerald-500",
      )}
    >
      <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        <TriggerIcon /> Trigger
      </p>
      <p className="text-sm leading-snug">When a message arrives in Gmail</p>
      <p className="text-[11px] text-muted-foreground">
        {data.empty ? "The only thing set so far" : "Watches INBOX · org connection"}
      </p>
      <Handles />
    </div>
  );
}

function PlaceholderNode() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed bg-muted/30 px-4 text-center">
      <p className="text-sm font-medium">Your workflow will appear here</p>
      <p className="text-xs text-muted-foreground">
        Describe the work in the chat; accepted proposals are drawn here.
      </p>
      <Handles />
    </div>
  );
}

function StepNode({ data }: NodeProps<Node<StepData>>) {
  const { view } = data;
  const selected = useSelected("step", view.id);
  const removed = view.change === "removed";
  return (
    <div
      className={cn(
        "flex h-full cursor-pointer flex-col gap-1 overflow-hidden rounded-lg border bg-card px-3 py-2 shadow-sm transition-opacity",
        view.type === "branch" && "border-violet-300 bg-violet-50/60",
        view.byPolicy && "border-dashed bg-muted/40",
        changeClasses(view.change),
        view.run === "taken" && "border-emerald-500 ring-1 ring-emerald-500/40",
        view.run === "skipped" && "opacity-35",
        selected && "ring-2 ring-primary",
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        <StepIcon step={view.step} />
        <span className="truncate">
          {view.type === "branch"
            ? `Branch · ${view.branch?.mode === "every" ? "every match" : "first match"}`
            : view.title}
        </span>
        <span className="ml-auto flex items-center gap-1 normal-case">
          <ChangeBadge change={view.change} />
          {view.run === "taken" ? <CircleCheck className="size-3.5 text-emerald-600" /> : null}
        </span>
      </div>
      <p
        className={cn("line-clamp-2 text-sm leading-snug", removed && "line-through")}
        title={view.text}
      >
        {view.text}
      </p>
      {view.before === null ? null : (
        <p className="truncate text-[11px] text-muted-foreground" title={view.before}>
          Before: {view.before}
        </p>
      )}
      {view.risk === null && view.type !== "approval" ? null : (
        <div className="mt-auto flex h-5 items-center gap-1 overflow-hidden">
          {view.risk === null ? null : <RiskBadge risk={view.risk} />}
          {view.type === "approval" ? <ReviewBadge byPolicy={view.byPolicy} /> : null}
        </div>
      )}
      <Handles />
    </div>
  );
}

function PathNode({ data }: NodeProps<Node<PathData>>) {
  const { path } = data;
  const selected = useSelected("path", path.id);
  const run = path.run;
  return (
    <div
      className={cn(
        "flex h-full cursor-pointer flex-col gap-0.5 overflow-hidden rounded-xl border border-violet-200 bg-violet-50 px-3 py-1.5 transition-opacity",
        path.otherwise && "border-dashed bg-muted/50",
        changeClasses(path.change),
        run?.status === "taken" && "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500/40",
        (run?.status === "not-reached" || run?.status === "not-checked") && "opacity-50",
        selected && "ring-2 ring-primary",
      )}
    >
      <div className="flex items-center gap-1 text-xs font-semibold">
        <span className="truncate">
          {path.order === null ? "" : `${String(path.order.index + 1)}. `}
          {path.name}
        </span>
        <ChangeBadge change={path.change} />
        {path.order === null ? null : (
          <span className="ml-auto">
            <MoveButtons id={path.id} index={path.order.index} count={path.order.count} />
          </span>
        )}
      </div>
      <p
        className={cn(
          "line-clamp-2 text-xs leading-snug",
          path.change === "removed" && "line-through",
        )}
        title={path.condition}
      >
        <span className="text-muted-foreground">{path.otherwise ? "When " : "When "}</span>
        {path.condition}
      </p>
      {path.before === null ? null : (
        <p className="truncate text-[11px] text-muted-foreground" title={path.before}>
          Before: {path.before}
        </p>
      )}
      <PathRunSummary run={run} compact otherwise={path.otherwise} />
      <Handles />
    </div>
  );
}

function EndNode({ data }: NodeProps<Node<EndData>>) {
  return (
    <div
      className={cn(
        "flex h-full items-center justify-center gap-1 rounded-full border bg-background text-[11px] text-muted-foreground",
        data.run === "taken" && "border-emerald-500 text-emerald-700",
        data.run === "skipped" && "opacity-40",
      )}
    >
      {data.label === "Stops here" ? <Octagon className="size-3" /> : null}
      {data.label}
      <Handles />
    </div>
  );
}

// Edges -----------------------------------------------------------------------------------------

const MenuContext = createContext<(insert: Insert, x: number, y: number) => void>(() => undefined);

function PlusEdge({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<GraphEdge>) {
  const open = useContext(MenuContext);
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    borderRadius: 10,
    offset: 12,
  });
  const run = data?.run ?? null;
  const insert = data?.insert ?? null;
  // On an edge that turns, put "+" just above the box it leads to, where the line is straight.
  const plusY = Math.abs(sourceX - targetX) > 2 ? targetY - 14 : labelY;
  const plusX = Math.abs(sourceX - targetX) > 2 ? targetX : labelX;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: run === "taken" ? "rgb(16 185 129)" : "rgb(163 163 163)",
          strokeWidth: run === "taken" ? 2.5 : 1.5,
          strokeDasharray: run === "skipped" || data?.removed === true ? "4 4" : undefined,
          opacity: run === "skipped" ? 0.5 : 1,
        }}
      />
      {insert === null ? null : (
        <EdgeLabelRenderer>
          <button
            type="button"
            aria-label="Add a step here"
            title="Add a step here"
            className="nodrag nopan absolute flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:border-primary hover:text-foreground"
            style={{
              transform: `translate(-50%, -50%) translate(${String(plusX)}px, ${String(plusY)}px)`,
              pointerEvents: "all",
            }}
            onClick={(event) => {
              event.stopPropagation();
              open(insert, event.clientX, event.clientY);
            }}
          >
            <Plus className="size-3" />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = {
  trigger: TriggerNode,
  placeholder: PlaceholderNode,
  step: StepNode,
  path: PathNode,
  end: EndNode,
};
const edgeTypes = { plus: PlusEdge };

// The graph -------------------------------------------------------------------------------------

type Padding = FitViewOptions["padding"];

// Room above for the overlays and below for the variant switcher.
const DEFAULT_PADDING: Padding = { top: "76px", bottom: "84px", x: "32px" };

export function FlowGraph({
  className,
  fitPadding = DEFAULT_PADDING,
}: {
  className?: string;
  fitPadding?: Padding;
}) {
  return (
    <ReactFlowProvider>
      <Graph className={className} fitPadding={fitPadding} />
    </ReactFlowProvider>
  );
}

function Graph({ className, fitPadding }: { className?: string; fitPadding: Padding }) {
  const p = usePrototype();
  const wrapper = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ insert: Insert; x: number; y: number } | null>(null);
  const { nodes, edges, key } = useMemo(() => {
    const graph = buildGraph(p.view, p.editable, p.tryItOn);
    return {
      nodes: layout(graph),
      edges: graph.edges,
      key: graph.nodes.map((n) => n.id).join(","),
    };
  }, [p.view, p.editable, p.tryItOn]);

  const openMenu = (insert: Insert, clientX: number, clientY: number) => {
    const box = wrapper.current?.getBoundingClientRect();
    if (box === undefined) return;
    setMenu({
      insert,
      x: Math.min(Math.max(clientX - box.left - 120, 8), box.width - 248),
      y: Math.min(clientY - box.top + 14, box.height - 360),
    });
  };

  return (
    <div ref={wrapper} className={cn("relative h-full w-full bg-muted/20", className)}>
      <MenuContext.Provider value={openMenu}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnScroll
          zoomOnScroll={false}
          minZoom={0.2}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
          onPaneClick={() => {
            setMenu(null);
          }}
          onMoveStart={() => {
            setMenu(null);
          }}
          onNodeClick={(_, node) => {
            setMenu(null);
            if (!p.editable) return;
            const data = node.data;
            if (data.kind === "trigger") p.select({ kind: "trigger" });
            if (data.kind === "step") p.select({ kind: "step", id: data.view.id });
            if (data.kind === "path") p.select({ kind: "path", id: data.path.id });
          }}
        >
          <Background gap={16} size={1} />
          <Controls showInteractive={false} position="bottom-left" />
          <FitOnChange
            layoutKey={`${p.shape}:${key}`}
            padding={fitPadding}
            nodes={nodes}
            wrapper={wrapper}
          />
        </ReactFlow>
      </MenuContext.Provider>
      {menu === null ? null : (
        <AddStepMenu
          className="absolute z-20"
          onClose={() => {
            setMenu(null);
          }}
          onPick={(kind: NewStepKind) => {
            p.insert(menu.insert.listId, menu.insert.index, kind);
            setMenu(null);
          }}
          style={{ left: menu.x, top: Math.max(menu.y, 8) }}
        />
      )}
    </div>
  );
}

function FitOnChange({
  layoutKey,
  padding,
  nodes,
  wrapper,
}: {
  layoutKey: string;
  padding: Padding;
  nodes: GraphNode[];
  wrapper: React.RefObject<HTMLDivElement | null>;
}) {
  const { fitView, setViewport } = useReactFlow();
  const narrow = useIsNarrow();
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const width = wrapper.current?.clientWidth ?? 0;
      const height = wrapper.current?.clientHeight ?? 0;
      const left = Math.min(...nodes.map((n) => n.position.x));
      const right = Math.max(...nodes.map((n) => n.position.x + (n.width ?? 0)));
      const top = Math.min(...nodes.map((n) => n.position.y));
      const bottom = Math.max(...nodes.map((n) => n.position.y + (n.height ?? 0)));
      const zoomW = (width - 64) / (right - left);
      const zoomH = (height - 160) / (bottom - top);
      if (Math.min(zoomW, zoomH, 1) >= 0.75) {
        void fitView({ padding, maxZoom: 1, duration: 200 });
        return;
      }
      // Fitting a tall or wide graph makes it unreadable: keep a readable size, start at the
      // top, and let the admin scroll down (or pan sideways).
      const zoom = Math.max(narrow ? 0.8 : 0.75, Math.min(zoomW, 0.9));
      const trigger = nodes.find((n) => n.id === "trigger");
      const center =
        (right - left) * zoom <= width - 32 || trigger === undefined
          ? (left + right) / 2
          : trigger.position.x + (trigger.width ?? 0) / 2;
      void setViewport(
        { x: width / 2 - center * zoom, y: (narrow ? 16 : 72) - top * zoom, zoom },
        { duration: 200 },
      );
    });
    return () => {
      cancelAnimationFrame(frame);
    };
    // Padding and nodes are fresh each render; refit only when the layout changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, fitView, narrow]);
  return null;
}
