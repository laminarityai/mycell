// The laid-out workflow graph as React Flow draws it: its boxes and lines, the placeholder under
// a trigger with no steps, and, while the graph is edited, a "+" on each line, the selected box
// marked and each box's issues on it.
import type { Edge, Node } from "@xyflow/react";
import type { RiskLevel } from "@/features/policy/types";
import type { InsertAt } from "@/features/spec/edit";
import type { GraphLayout, LayoutEdge, LayoutNode } from "@/features/spec/layout";
import type { SpecIssue } from "@/features/spec/types";
import { addLabel, edgeStyle } from "./graph-edges";

/** What clicking a box selects for the side panel. */
export type GraphSelection =
  | { kind: "trigger" }
  | { kind: "step"; id: string; byPolicy: boolean }
  | { kind: "path"; id: string };

export type GraphEditing = {
  /** The selected box's node ID (`selectedNodeId`), marked on the graph; null for none. */
  selected: string | null;
  onSelect: (selection: GraphSelection) => void;
  /**
   * "+" was clicked: where the step goes, the point in the graph's frame it was clicked at,
   * and the frame's size.
   */
  onAdd: (at: InsertAt, point: { x: number; y: number; width: number; height: number }) => void;
  /** The empty canvas was clicked or panned. */
  onPaneClick: () => void;
  /** Live validation's issues, by the ID of the step or path each is about. */
  issues: ReadonlyMap<string, readonly SpecIssue[]>;
};

/** What a box's data holds besides its place in the layout. */
export type BoxMarks = { selected?: boolean; issues?: readonly SpecIssue[] };

export type Drawing = { nodes: Node[]; edges: Edge[]; width: number; height: number };

/** The placeholder's box, or the end a first step is added above, under the trigger. */
const PLACEHOLDER_HEIGHT = 116;
const PLACEHOLDER_GAP = 40;
const END_WIDTH = 72;
const END_HEIGHT = 28;

/**
 * A read-only graph whose boxes can still be selected, as a run's page selects a step to show its
 * details: the selected box's node ID, and what a click selects.
 */
export type GraphSelecting = {
  selected: string | null;
  onSelect: (selection: GraphSelection) => void;
};

export function toDrawing(
  layout: GraphLayout<RiskLevel>,
  placeholder: boolean,
  editing: GraphEditing | undefined,
  selecting?: GraphSelecting,
): Drawing {
  const selected = (editing ?? selecting)?.selected;
  const nodes: Node[] = layout.nodes.map((node) => {
    const marks: BoxMarks = { selected: selected === node.id, issues: issuesOf(node) };
    const drawn = box(node.id, node.kind, node, node.width, node.height, { ...node, ...marks });
    const opens = (editing ?? selecting) !== undefined && node.kind !== "end";
    return opens ? { ...drawn, className: "cursor-pointer" } : drawn;
  });
  const edges = layout.edges.map((edge) => toEdge(edge, editing !== undefined));
  const trigger = layout.nodes.find((node) => node.kind === "trigger");
  const empty = layout.nodes.length === 1;
  if (trigger === undefined || !empty || (!placeholder && editing === undefined)) {
    return { nodes, edges, width: layout.width, height: layout.height };
  }
  // Nothing under the trigger yet: the placeholder says where the workflow will appear, or an
  // end with a "+" above it starts one.
  const end = editing !== undefined;
  const width = end ? END_WIDTH : trigger.width;
  const height = end ? END_HEIGHT : PLACEHOLDER_HEIGHT;
  const id = end ? "end:root" : "placeholder";
  const at = {
    x: trigger.x + (trigger.width - width) / 2,
    y: trigger.y + trigger.height + PLACEHOLDER_GAP,
  };
  const data = end ? { label: "End", run: null, removed: false } : {};
  nodes.push(box(id, end ? "end" : "placeholder", at, width, height, data));
  const insert = end ? { list: "root", after: null } : null;
  const line = { id: `trigger->${id}`, source: trigger.id, target: id, run: null, insert };
  edges.push(toEdge({ ...line, removed: false }, end));
  return { nodes, edges, width: layout.width, height: at.y + height };

  function issuesOf(node: LayoutNode<RiskLevel>): readonly SpecIssue[] {
    if (editing === undefined) return [];
    const of = node.kind === "step" ? node.step.id : node.kind === "path" ? node.path.id : null;
    return of === null ? [] : (editing.issues.get(of) ?? []);
  }
}

function box(
  id: string,
  type: string,
  at: { x: number; y: number },
  width: number,
  height: number,
  data: Record<string, unknown>,
): Node {
  return {
    id,
    type,
    position: { x: at.x, y: at.y },
    width,
    height,
    data,
    draggable: false,
    connectable: false,
    selectable: false,
  };
}

function toEdge(edge: LayoutEdge, editing: boolean): Edge {
  const insert = editing ? edge.insert : null;
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: editing ? "add" : "smoothstep",
    focusable: false,
    style: edgeStyle(edge),
    data: insert === null ? { insert } : { insert, label: addLabel(insert) },
  };
}

/** What clicking a box selects: the trigger, a step, or a path; nothing for an end. */
export function selectionOf(node: Node): GraphSelection | null {
  if (node.type === "placeholder") return null;
  const data = node.data as LayoutNode<RiskLevel>;
  switch (data.kind) {
    case "trigger":
      return { kind: "trigger" };
    case "step":
      if (data.step.change === "removed") return null;
      return { kind: "step", id: data.step.id, byPolicy: data.step.review === "policy" };
    case "path":
      return data.path.change === "removed" ? null : { kind: "path", id: data.path.id };
    case "end":
      return null;
  }
}

/** The node ID the graph draws a selection as. */
export function selectedNodeId(selection: GraphSelection | null): string | null {
  if (selection === null) return null;
  return selection.kind === "trigger" ? "trigger" : `${selection.kind}:${selection.id}`;
}
