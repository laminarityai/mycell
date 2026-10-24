"use client";

// The workflow graph's boxes, as React Flow draws them: the trigger, a step, a path's heading
// with its condition in plain words, and the end of a path. Each box is the size the layout
// gave it, so text is clamped to fit.
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { CircleCheck, CircleX, Inbox, Octagon } from "lucide-react";
import type { RiskLevel } from "@/features/policy/types";
import { boxLabel, type LayoutNode } from "@/features/spec/layout";
import { cn } from "@/lib/utils";
import type { BoxMarks } from "./graph-drawing";
import {
  ChangeBadge,
  IssueMark,
  PathRunSummary,
  ReviewBadge,
  StepIcon,
  changeClasses,
} from "./graph-parts";
import { RiskBadge } from "./risk-badge";

type Of<Kind extends LayoutNode["kind"]> = NodeProps<
  Node<Extract<LayoutNode<RiskLevel>, { kind: Kind }> & BoxMarks, Kind>
>;

/** A box selected for the side panel, or with issues, while the graph is edited. */
function marked(data: BoxMarks): string {
  return cn(
    (data.issues?.length ?? 0) > 0 && "border-red-500",
    data.selected === true && "ring-2 ring-primary",
  );
}

const HIDDEN = "!h-1 !min-h-0 !w-1 !min-w-0 !border-0 !bg-transparent";

/** The lines' anchors, top and bottom; nothing connects by hand. */
function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Top} className={HIDDEN} isConnectable={false} />
      <Handle type="source" position={Position.Bottom} className={HIDDEN} isConnectable={false} />
    </>
  );
}

const HEADING =
  "flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase";

export function TriggerNode({ data }: Of<"trigger">) {
  return (
    <div
      role="group"
      aria-label={boxLabel(data)}
      className={cn(
        "flex h-full flex-col gap-0.5 rounded-lg border bg-card px-3 py-2 shadow-sm",
        data.run === "taken" && "border-emerald-500",
        marked(data),
      )}
    >
      <p className={HEADING}>
        <Inbox aria-hidden className="size-3.5 shrink-0" /> Trigger
      </p>
      <p className="text-sm leading-snug">When a message arrives in Gmail</p>
      <Handles />
    </div>
  );
}

export function StepNode({ data }: Of<"step">) {
  const { step } = data;
  const removed = step.change === "removed";
  return (
    <div
      role="group"
      aria-label={boxLabel(data)}
      className={cn(
        "flex h-full flex-col gap-1 overflow-hidden rounded-lg border bg-card px-3 py-2 shadow-sm",
        step.type === "branch" && "border-violet-300 bg-violet-50/60",
        step.review === "policy" && "border-dashed bg-muted/40",
        changeClasses(step.change),
        step.run === "taken" && "border-emerald-500 ring-1 ring-emerald-500/40",
        step.run === "failed" && "border-red-500 ring-1 ring-red-500/40",
        step.run === "skipped" && "opacity-35",
        marked(data),
      )}
    >
      <div className={HEADING}>
        <StepIcon step={step} />
        <span className="truncate">{step.title}</span>
        <span className="ml-auto flex items-center gap-1 normal-case">
          <IssueMark issues={data.issues} />
          <ChangeBadge change={step.change} />
          {step.run === "taken" ? (
            <CircleCheck aria-label="Ran" className="size-3.5 text-emerald-600" />
          ) : null}
          {step.run === "failed" ? (
            <CircleX aria-label="Failed" className="size-3.5 text-red-600" />
          ) : null}
        </span>
      </div>
      <p className={cn("line-clamp-2 text-sm leading-snug", removed && "line-through")}>
        {step.text}
      </p>
      {step.before === null ? null : (
        <p className="truncate text-[11px] text-muted-foreground" title={step.before}>
          Before: {step.before}
        </p>
      )}
      {step.risk === null && step.review === null ? null : (
        <div className="mt-auto flex h-5 items-center gap-1 overflow-hidden">
          {step.risk === null ? null : <RiskBadge risk={step.risk} />}
          {step.review === null ? null : <ReviewBadge byPolicy={step.review === "policy"} />}
        </div>
      )}
      <Handles />
    </div>
  );
}

export function PathNode({ data }: Of<"path">) {
  const { path } = data;
  const otherwise = path.name === null;
  const status = path.run?.status;
  return (
    <div
      role="group"
      aria-label={boxLabel(data)}
      className={cn(
        "flex h-full flex-col gap-0.5 overflow-hidden rounded-xl border border-violet-200 bg-violet-50 px-3 py-1.5",
        otherwise && "border-dashed bg-muted/50",
        changeClasses(path.change),
        status === "taken" && "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500/40",
        (status === "not_checked" || status === "not_needed") && "opacity-50",
        marked(data),
      )}
    >
      <div className="flex items-center gap-1 text-xs font-semibold">
        <span className="truncate">{path.name ?? "Otherwise"}</span>
        <span className="ml-auto flex items-center gap-1">
          <IssueMark issues={data.issues} />
          <ChangeBadge change={path.change} />
        </span>
      </div>
      <p
        className={cn(
          "line-clamp-2 text-xs leading-snug",
          path.change === "removed" && "line-through",
        )}
        title={path.condition ?? undefined}
      >
        <span className="text-muted-foreground">When </span>
        {path.condition ?? "no other path applies"}
      </p>
      {path.before === null ? null : (
        <p className="truncate text-[11px] text-muted-foreground" title={path.before}>
          Before: {path.before}
        </p>
      )}
      <PathRunSummary run={path.run} />
      <Handles />
    </div>
  );
}

export function EndNode({ data }: Of<"end">) {
  return (
    <div
      className={cn(
        "flex h-full items-center justify-center gap-1 rounded-full border bg-background text-[11px] text-muted-foreground",
        data.run === "taken" && "border-emerald-500 text-emerald-700",
        data.run === "skipped" && "opacity-40",
        data.removed && "border-dashed",
      )}
    >
      {data.label === "Stops here" ? <Octagon aria-hidden className="size-3" /> : null}
      {data.label}
      <Handles />
    </div>
  );
}

/** Where the steps go before a workflow has any, so the graph keeps its shape. */
export function PlaceholderNode() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed bg-background/80 px-4 text-center">
      <p className="text-sm font-medium">Your workflow will appear here</p>
      <p className="text-xs text-muted-foreground">
        Describe the work in the chat; its proposals are drawn here.
      </p>
      <Handles />
    </div>
  );
}

export const nodeTypes = {
  trigger: TriggerNode,
  step: StepNode,
  path: PathNode,
  end: EndNode,
  placeholder: PlaceholderNode,
};
