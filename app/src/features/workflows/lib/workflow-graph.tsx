"use client";

// The workflow as a graph, top to bottom: the spec as the policy engine leaves it (reviews and
// risk levels from the company's action set), a proposal drawn as its changes, or a Try it's steps
// and paths lit up.
// The layout is automatic; the admin pans and zooms. It opens at full size and scrolls rather
// than shrinking a big workflow to fit. Being edited, its boxes open a side panel and
// "+" on its lines adds a step; the caller draws the panel and the menu over it.
import "@xyflow/react/dist/style.css";
import { Background, Controls, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { useMemo, useRef, type ReactNode } from "react";
import { applyPolicy } from "@/features/policy/engine";
import type { ActionSet, RiskLevel } from "@/features/policy/types";
import type { InsertAt } from "@/features/spec/edit";
import {
  graphView,
  type GraphActionInfo,
  type GraphSide,
  type GraphTrace,
} from "@/features/spec/graph";
import { layoutTree } from "@/features/spec/layout";
import type { Spec } from "@/features/spec/types";
import { cn } from "@/lib/utils";
import { useActionSet } from "./action-set-context";
import { selectionOf, toDrawing, type Drawing, type GraphEditing } from "./graph-drawing";
import { AddMenuContext, edgeTypes } from "./graph-edges";
import { nodeTypes } from "./graph-nodes";
import { MARGIN, OpenReadable } from "./graph-viewport";

export type { GraphEditing, GraphSelection } from "./graph-drawing";
export { selectedNodeId } from "./graph-drawing";

export type WorkflowGraphProps = {
  /** The workflow's spec, saved or being edited; null before it has one. */
  spec: Spec | null;
  /** A proposed spec, drawn as its changes to `spec`. */
  proposal?: Spec;
  /** A Try it of `spec`, whose steps and paths the graph lights up. */
  trace?: GraphTrace | null;
  /** With no steps to draw, a box under the trigger says where the workflow will appear. */
  placeholder?: boolean;
  /**
   * The graph fills its parent's height, as beside the builder chat. Otherwise it is as tall as
   * the workflow, within limits.
   */
  fill?: boolean;
  /**
   * The graph is being edited: its boxes and paths can be selected, and "+" on its lines adds a
   * step. Left out, it's read only.
   */
  editing?: GraphEditing;
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
  editing,
  children,
  className,
}: WorkflowGraphProps) {
  const actions = useActionSet();
  const view = useMemo(() => {
    const current = spec === null ? null : withPolicy(spec, actions);
    return graphView<RiskLevel>(current?.spec ?? null, {
      action: (name) => actionInfo(name, actions),
      insertedApprovals: current?.insertedApprovals,
      proposal: proposal === undefined ? undefined : withPolicy(proposal, actions),
      trace: trace ?? undefined,
    });
  }, [spec, proposal, trace, actions]);
  const layout = useMemo(
    () => toDrawing(layoutTree(view), placeholder, editing),
    [view, placeholder, editing],
  );
  return (
    <div className={cn("flex flex-col gap-2", fill && "h-full min-h-0", className)}>
      {view.tried ? (
        <p className={cn("text-sm text-muted-foreground", fill && "px-4 pt-3")}>
          Try it: lit steps ran, faded ones didn&apos;t. Each path says why.
        </p>
      ) : null}
      <ReactFlowProvider>
        <Canvas layout={layout} fill={fill} editing={editing}>
          {children}
        </Canvas>
      </ReactFlowProvider>
    </div>
  );
}

/** The spec as a version would hold it; one `actions` no longer allows is drawn as written. */
function withPolicy(spec: Spec, actions: ActionSet): GraphSide {
  const policy = applyPolicy(spec, actions);
  if (!policy.ok) return { spec };
  return { spec: policy.spec, insertedApprovals: policy.inserted.map((step) => step.stepId) };
}

function actionInfo(name: string, actions: ActionSet): GraphActionInfo<RiskLevel> | undefined {
  const action = actions.find(name);
  if (action === undefined) return undefined;
  const { risk, description, app, conditionFields } = action;
  return { risk, description, app, conditionFields };
}

/** Filling a pane, the drawing starts lower, leaving room for a caption over its top. */
const FILL_TOP = 80;
/** The canvas's height grows with the workflow, between these; taller while it's edited. */
const MIN_HEIGHT = 320;
const MIN_EDITING_HEIGHT = 560;
const MAX_HEIGHT = 720;
/** What a screen reader hears on a focused box: how to open it, not React Flow's own keys. */
const ARIA_LABELS = {
  "node.a11yDescription.default": "Press Enter or Space to open it in the side panel.",
};

function Canvas({
  layout,
  fill,
  editing,
  children,
}: {
  layout: Drawing;
  fill: boolean;
  editing: GraphEditing | undefined;
  children: ReactNode;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const min = editing === undefined ? MIN_HEIGHT : MIN_EDITING_HEIGHT;
  const height = Math.min(Math.max(layout.height + 2 * MARGIN, min), MAX_HEIGHT);
  const openMenu = (at: InsertAt, clientX: number, clientY: number) => {
    const frame = wrapper.current?.getBoundingClientRect();
    if (frame === undefined) return;
    const { width, height } = frame;
    editing?.onAdd(at, { x: clientX - frame.left, y: clientY - frame.top, width, height });
  };
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
      <AddMenuContext value={editing === undefined ? null : openMenu}>
        <ReactFlow
          nodes={layout.nodes}
          edges={layout.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          // Only a box that opens is focusable (toDrawing marks it): the rest are read, not used.
          nodesFocusable={false}
          elementsSelectable={false}
          ariaLabelConfig={ARIA_LABELS}
          // Read only, no box opens, so there's nothing to do from the keyboard.
          disableKeyboardA11y={editing === undefined}
          panOnScroll
          zoomOnScroll={false}
          minZoom={0.25}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => {
            const selection = selectionOf(node);
            if (selection !== null) editing?.onSelect(selection);
          }}
          onKeyDown={(event) => {
            // Enter or Space on a focused box opens it, as a click does.
            if (editing === undefined || (event.key !== "Enter" && event.key !== " ")) return;
            const target = event.target;
            if (
              !(target instanceof HTMLElement) ||
              !target.classList.contains("react-flow__node")
            ) {
              return;
            }
            const node = layout.nodes.find((candidate) => candidate.id === target.dataset.id);
            const selection = node === undefined ? null : selectionOf(node);
            if (selection === null) return;
            event.preventDefault();
            editing.onSelect(selection);
          }}
          onPaneClick={editing?.onPaneClick}
          onMoveStart={(event) => {
            // The admin panned or zoomed; where the graph opened isn't them.
            if (event !== null) editing?.onPaneClick();
          }}
        >
          <Background gap={16} size={1} />
          <Controls showInteractive={false} position="bottom-left" />
          <OpenReadable
            layout={layout}
            wrapper={wrapper}
            top={fill ? FILL_TOP : MARGIN}
            editing={editing !== undefined}
          />
        </ReactFlow>
      </AddMenuContext>
      {children}
    </div>
  );
}
