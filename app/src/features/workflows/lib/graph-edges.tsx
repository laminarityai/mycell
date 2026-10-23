"use client";

// The workflow graph's lines. A line in a graph being edited carries a "+" that adds a step
// where it runs: the list it's in and the step before it, as the layout says.
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { Plus } from "lucide-react";
import { createContext, useContext, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import type { InsertAt } from "@/features/spec/edit";
import type { LayoutEdge } from "@/features/spec/layout";

/** Opens the "+" menu for a place, at the point on screen that was clicked. */
export type OpenAddMenu = (at: InsertAt, clientX: number, clientY: number) => void;

export const AddMenuContext = createContext<OpenAddMenu | null>(null);

type AddEdgeData = { insert: InsertAt | null; label: string };
export type AddEdgeType = Edge<AddEdgeData, "add">;

/** A line's look, by what a Try it or a proposal says of it. */
export function edgeStyle(edge: Pick<LayoutEdge, "run" | "removed">): CSSProperties {
  const taken = edge.run === "taken";
  return {
    stroke: taken ? "rgb(16 185 129)" : "rgb(163 163 163)",
    strokeWidth: taken ? 2.5 : 1.5,
    strokeDasharray: edge.run === "skipped" || edge.removed ? "4 4" : undefined,
    opacity: edge.run === "skipped" ? 0.5 : 1,
  };
}

/** What "+" says it does: where the step goes, by the step before it or the list's top. */
export function addLabel(at: InsertAt): string {
  if (at.after !== null) return `Add a step after ${at.after}`;
  return at.list === "root" ? "Add a step first" : `Add a step first on ${at.list}`;
}

export function AddEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  style,
}: EdgeProps<AddEdgeType>) {
  const open = useContext(AddMenuContext);
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY });
  const insert = data?.insert ?? null;
  // On a line that turns, "+" sits just above the box it leads to, where the line is straight.
  const turns = Math.abs(sourceX - targetX) > 2;
  const x = turns ? targetX : labelX;
  const y = turns ? targetY - 14 : labelY;
  return (
    <>
      <BaseEdge id={id} path={path} style={style} />
      {insert === null || open === null ? null : (
        <EdgeLabelRenderer>
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            aria-label={data?.label}
            title={data?.label}
            className="nodrag nopan absolute size-5 rounded-full text-muted-foreground shadow-sm hover:border-primary"
            style={{
              transform: `translate(-50%, -50%) translate(${String(x)}px, ${String(y)}px)`,
              pointerEvents: "all",
            }}
            onClick={(event) => {
              event.stopPropagation();
              open(insert, event.clientX, event.clientY);
            }}
          >
            <Plus aria-hidden className="size-3" />
          </Button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { add: AddEdge };
