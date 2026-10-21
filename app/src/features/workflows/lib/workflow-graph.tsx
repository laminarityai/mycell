"use client";

// The workflow as a graph, top to bottom: the spec as the policy engine leaves it (reviews and
// risk levels from the catalog), a proposal drawn as its changes, or a Try it's route lit up.
// The layout is automatic; the admin pans and zooms. It opens at a readable size and scrolls
// rather than shrinking a big workflow to fit.
import "@xyflow/react/dist/style.css";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { findAction } from "@/features/policy/catalog";
import { applyPolicy } from "@/features/policy/engine";
import type { RiskLevel } from "@/features/policy/types";
import {
  graphView,
  type GraphActionInfo,
  type GraphSide,
  type GraphTrace,
} from "@/features/spec/graph";
import { layoutTree, type GraphLayout, type LayoutEdge } from "@/features/spec/layout";
import type { Spec } from "@/features/spec/types";
import { cn } from "@/lib/utils";
import { nodeTypes } from "./graph-nodes";

export type WorkflowGraphProps = {
  /** The workflow's spec, saved or being edited; null before it has one. */
  spec: Spec | null;
  /** A proposed spec, drawn as its changes to `spec`. */
  proposal?: Spec;
  /** A Try it of `spec`, whose route the graph lights up. */
  trace?: GraphTrace | null;
  /** With no steps to draw, a box under the trigger says where the workflow will appear. */
  placeholder?: boolean;
  /**
   * The graph fills its parent's height, as beside the builder chat. Otherwise it is as tall as
   * the workflow, within limits.
   */
  fill?: boolean;
  /** Drawn over the graph, inside its frame: a caption, or a panel sliding over its edge. */
  children?: ReactNode;
  className?: string;
};

export function WorkflowGraph({
  spec,
  proposal,
  trace,
  placeholder = false,
  fill = false,
  children,
  className,
}: WorkflowGraphProps) {
  const view = useMemo(() => {
    const current = spec === null ? null : withPolicy(spec);
    return graphView<RiskLevel>(current?.spec ?? null, {
      action: actionInfo,
      insertedApprovals: current?.insertedApprovals,
      proposal: proposal === undefined ? undefined : withPolicy(proposal),
      trace: trace ?? undefined,
    });
  }, [spec, proposal, trace]);
  const layout = useMemo(
    () => withPlaceholder(layoutTree(view), placeholder && view.steps.length === 0),
    [view, placeholder],
  );
  return (
    <div className={cn("flex flex-col gap-2", fill && "h-full min-h-0", className)}>
      {view.tried ? (
        <p className={cn("text-sm text-muted-foreground", fill && "px-4 pt-3")}>
          Try it: lit steps ran, faded ones didn&apos;t. Each path says why.
        </p>
      ) : null}
      <ReactFlowProvider>
        <Canvas layout={layout} fill={fill}>
          {children}
        </Canvas>
      </ReactFlowProvider>
    </div>
  );
}

/** The spec as a version would hold it; one the catalog no longer allows is drawn as written. */
function withPolicy(spec: Spec): GraphSide {
  const policy = applyPolicy(spec);
  if (!policy.ok) return { spec };
  return { spec: policy.spec, insertedApprovals: policy.inserted.map((step) => step.stepId) };
}

function actionInfo(name: string): GraphActionInfo<RiskLevel> | undefined {
  const action = findAction(name);
  if (action === undefined) return undefined;
  return { risk: action.risk, description: action.description, app: action.app };
}

/** Space around the drawing, and the smallest zoom it opens at before it scrolls instead. */
const MARGIN = 24;
/** Filling a pane, the drawing starts lower, leaving room for a caption over its top. */
const FILL_TOP = 80;
const READABLE_ZOOM = 0.75;
/** The canvas's height grows with the workflow, between these. */
const MIN_HEIGHT = 320;
const MAX_HEIGHT = 720;
/** The placeholder's box, under the trigger. */
const PLACEHOLDER_HEIGHT = 116;
const PLACEHOLDER_GAP = 40;

type Drawing = {
  nodes: Node[];
  edges: Edge[];
  width: number;
  height: number;
};

/** The laid-out graph as React Flow draws it, with the placeholder under the trigger. */
function withPlaceholder(layout: GraphLayout<RiskLevel>, placeholder: boolean): Drawing {
  const nodes: Node[] = layout.nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    position: { x: node.x, y: node.y },
    width: node.width,
    height: node.height,
    data: node,
    draggable: false,
    connectable: false,
    selectable: false,
  }));
  const edges = layout.edges.map(toEdge);
  const trigger = layout.nodes.find((node) => node.kind === "trigger");
  if (!placeholder || trigger === undefined) {
    return { nodes, edges, width: layout.width, height: layout.height };
  }
  const y = trigger.y + trigger.height + PLACEHOLDER_GAP;
  nodes.push({
    id: "placeholder",
    type: "placeholder",
    position: { x: trigger.x, y },
    width: trigger.width,
    height: PLACEHOLDER_HEIGHT,
    data: {},
    draggable: false,
    connectable: false,
    selectable: false,
  });
  edges.push({
    id: "trigger->placeholder",
    source: trigger.id,
    target: "placeholder",
    type: "smoothstep",
    focusable: false,
    style: { stroke: "rgb(163 163 163)", strokeWidth: 1.5, strokeDasharray: "4 4" },
  });
  return { nodes, edges, width: layout.width, height: y + PLACEHOLDER_HEIGHT };
}

function Canvas({
  layout,
  fill,
  children,
}: {
  layout: Drawing;
  fill: boolean;
  children: ReactNode;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const height = Math.min(Math.max(layout.height + 2 * MARGIN, MIN_HEIGHT), MAX_HEIGHT);
  return (
    <div
      ref={wrapper}
      role="region"
      aria-label="Workflow graph"
      className={cn(
        "relative w-full overflow-hidden bg-muted/20",
        fill ? "min-h-0 flex-1" : "rounded-lg border",
      )}
      style={fill ? undefined : { height }}
    >
      <ReactFlow
        nodes={layout.nodes}
        edges={layout.edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        zoomOnScroll={false}
        minZoom={0.25}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} />
        <Controls showInteractive={false} position="bottom-left" />
        <OpenReadable layout={layout} wrapper={wrapper} top={fill ? FILL_TOP : MARGIN} />
      </ReactFlow>
      {children}
    </div>
  );
}

function toEdge(edge: LayoutEdge): Edge {
  const taken = edge.run === "taken";
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    focusable: false,
    style: {
      stroke: taken ? "rgb(16 185 129)" : "rgb(163 163 163)",
      strokeWidth: taken ? 2.5 : 1.5,
      strokeDasharray: edge.run === "skipped" || edge.removed ? "4 4" : undefined,
      opacity: edge.run === "skipped" ? 0.5 : 1,
    },
  };
}

/**
 * Opens the drawing at full size when it fits, or shrunk no further than a readable size;
 * past that, it starts at the top, centred on the trigger, and the admin scrolls. A graph
 * hidden when it was drawn (a tab not shown) opens once it has a width.
 */
function OpenReadable({
  layout,
  wrapper,
  top,
}: {
  layout: Drawing;
  wrapper: RefObject<HTMLDivElement | null>;
  /** Where the drawing's top starts in the frame. */
  top: number;
}) {
  const { setViewport } = useReactFlow();
  const width = useWidth(wrapper);
  const shape = layout.nodes
    .map((node) => `${node.id}@${String(node.position.x)},${String(node.position.y)}`)
    .join();
  const shown = width > 0;
  useEffect(() => {
    if (!shown) return;
    const room = width - 2 * MARGIN;
    const zoom = Math.min(1, Math.max(READABLE_ZOOM, room / layout.width));
    const trigger = layout.nodes.find((node) => node.type === "trigger");
    const fits = layout.width * zoom <= room;
    const center =
      fits || trigger === undefined
        ? layout.width / 2
        : trigger.position.x + (trigger.width ?? 0) / 2;
    void setViewport({ x: width / 2 - center * zoom, y: top, zoom });
    // Re-open only when the drawing's shape changes or it's first shown, not on every Try it,
    // redraw or resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, shown, top, setViewport]);
  return null;
}

/** The element's width, kept up to date; 0 while it isn't shown. */
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => {
      setWidth(element.clientWidth);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return width;
}
