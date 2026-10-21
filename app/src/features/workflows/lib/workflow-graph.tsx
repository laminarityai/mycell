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
} from "@xyflow/react";
import { useEffect, useMemo, useRef, type RefObject } from "react";
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
  className?: string;
};

export function WorkflowGraph({ spec, proposal, trace, className }: WorkflowGraphProps) {
  const view = useMemo(() => {
    const current = spec === null ? null : withPolicy(spec);
    return graphView<RiskLevel>(current?.spec ?? null, {
      action: actionInfo,
      insertedApprovals: current?.insertedApprovals,
      proposal: proposal === undefined ? undefined : withPolicy(proposal),
      trace: trace ?? undefined,
    });
  }, [spec, proposal, trace]);
  const layout = useMemo(() => layoutTree(view), [view]);
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {view.tried ? (
        <p className="text-sm text-muted-foreground">
          Try it: lit steps ran, faded ones didn&apos;t. Each path says why.
        </p>
      ) : null}
      <ReactFlowProvider>
        <Canvas layout={layout} />
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
const READABLE_ZOOM = 0.75;
/** The canvas's height grows with the workflow, between these. */
const MIN_HEIGHT = 320;
const MAX_HEIGHT = 720;

function Canvas({ layout }: { layout: GraphLayout<RiskLevel> }) {
  const wrapper = useRef<HTMLDivElement>(null);
  const nodes = useMemo(
    () =>
      layout.nodes.map((node) => ({
        id: node.id,
        type: node.kind,
        position: { x: node.x, y: node.y },
        width: node.width,
        height: node.height,
        data: node,
        draggable: false,
        connectable: false,
        selectable: false,
      })),
    [layout],
  );
  const edges = useMemo(() => layout.edges.map(toEdge), [layout]);
  const height = Math.min(Math.max(layout.height + 2 * MARGIN, MIN_HEIGHT), MAX_HEIGHT);
  return (
    <div
      ref={wrapper}
      role="region"
      aria-label="Workflow graph"
      className="relative w-full overflow-hidden rounded-lg border bg-muted/20"
      style={{ height }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
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
        <OpenReadable layout={layout} wrapper={wrapper} />
      </ReactFlow>
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
 * past that, it starts at the top, centred on the trigger, and the admin scrolls.
 */
function OpenReadable({
  layout,
  wrapper,
}: {
  layout: GraphLayout<RiskLevel>;
  wrapper: RefObject<HTMLDivElement | null>;
}) {
  const { setViewport } = useReactFlow();
  const shape = layout.nodes.map((node) => `${node.id}@${String(node.x)},${String(node.y)}`).join();
  useEffect(() => {
    const width = wrapper.current?.clientWidth ?? 0;
    const room = width - 2 * MARGIN;
    const zoom = Math.min(1, Math.max(READABLE_ZOOM, room / layout.width));
    const trigger = layout.nodes.find((node) => node.kind === "trigger");
    const fits = layout.width * zoom <= room;
    const center = fits || trigger === undefined ? layout.width / 2 : trigger.x + trigger.width / 2;
    void setViewport({ x: width / 2 - center * zoom, y: MARGIN, zoom });
    // Re-open only when the drawing's shape changes, not on every Try it or redraw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, setViewport]);
  return null;
}
