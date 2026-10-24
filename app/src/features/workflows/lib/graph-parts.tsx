// The workflow graph's small pieces: a step's icon, the review and change badges, the colours a
// change gives a box, and a path's Try it result.
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  GitBranch,
  Hand,
  Mail,
  PenLine,
  ScanText,
  ShieldCheck,
  Table2,
  Tags,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { GraphChange, GraphPath, GraphStep } from "@/features/spec/graph";
import type { SpecIssue, StepType } from "@/features/spec/types";
import { cn } from "@/lib/utils";

const STEP_ICONS: Record<StepType, LucideIcon> = {
  classify: Tags,
  extract: ScanText,
  tool: Mail,
  draft: PenLine,
  approval: ShieldCheck,
  escalate: Hand,
  branch: GitBranch,
};

export function StepIcon({ step }: { step: Pick<GraphStep, "type" | "app"> }) {
  const Icon = step.type === "tool" && step.app === "Sheets" ? Table2 : STEP_ICONS[step.type];
  return <Icon aria-hidden className="size-3.5 shrink-0" />;
}

/** Where a person reviews; one the policy engine inserted can't be removed. */
export function ReviewBadge({ byPolicy }: { byPolicy: boolean }) {
  return (
    <Badge variant="secondary" className="gap-1">
      <ShieldCheck aria-hidden className="size-3" />
      {byPolicy ? "Waits for review (required by policy)" : "Waits for review"}
    </Badge>
  );
}

const CHANGE_LABELS: Record<GraphChange, string> = {
  added: "New",
  removed: "Removed",
  changed: "Changed",
};

export function ChangeBadge({ change }: { change: GraphChange | null }) {
  if (change === null) return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        change === "added" && "border-emerald-500 text-emerald-700",
        change === "removed" && "border-red-400 text-red-700",
        change === "changed" && "border-amber-500 text-amber-700",
      )}
    >
      {CHANGE_LABELS[change]}
    </Badge>
  );
}

/** A box's border and background for a proposal's change. */
export function changeClasses(change: GraphChange | null): string {
  switch (change) {
    case "added":
      return "border-emerald-500 bg-emerald-50/60 ring-1 ring-emerald-500/30";
    case "removed":
      return "border-dashed border-red-300 bg-red-50/40 text-muted-foreground";
    case "changed":
      return "border-amber-500 bg-amber-50/60 ring-1 ring-amber-500/30";
    case null:
      return "";
  }
}

/** How many issues live validation found with a box; its title lists them. */
export function IssueMark({ issues }: { issues: readonly SpecIssue[] | undefined }) {
  const count = issues?.length ?? 0;
  if (issues === undefined || count === 0) return null;
  const words = count === 1 ? "1 issue" : `${String(count)} issues`;
  return (
    <span
      role="img"
      aria-label={words}
      title={issues.map((issue) => issue.message).join("\n")}
      className="flex items-center gap-0.5 text-[11px] font-medium text-red-700 normal-case"
    >
      <CircleAlert aria-hidden className="size-3.5" />
      {count}
    </span>
  );
}

const NOT_RUN: Record<"not_checked" | "not_needed", string> = {
  not_checked: "Not checked: an earlier path ran",
  not_needed: "Not needed: another path applied",
};

/**
 * Whether a Try it or a run took the path, and why: each check passed or failed, with its
 * reason. A run redacted for the viewer gives no checks, so a named path just says taken.
 */
export function PathRunSummary({
  run,
  otherwise = false,
}: {
  run: GraphPath["run"];
  otherwise?: boolean;
}) {
  if (run === null) return null;
  if (run.status === "not_checked" || run.status === "not_needed") {
    return (
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <CircleDashed aria-hidden className="size-3" /> {NOT_RUN[run.status]}
      </p>
    );
  }
  const taken = run.status === "taken";
  return (
    <div className="flex flex-col gap-0.5">
      <p
        className={cn(
          "flex items-center gap-1 text-xs font-medium",
          taken ? "text-emerald-700" : "text-red-700",
        )}
      >
        {taken ? (
          <CircleCheck aria-hidden className="size-3" />
        ) : (
          <CircleX aria-hidden className="size-3" />
        )}
        {taken ? (otherwise ? "Taken: no other path applied" : "Taken") : "Didn't apply"}
      </p>
      {run.checks.map((check, index) => (
        <p
          key={index}
          className="line-clamp-2 text-[11px] leading-snug text-muted-foreground"
          title={`${check.check}: it ${check.reason}`}
        >
          <span className={check.passed ? "text-emerald-700" : "text-red-700"}>
            {check.passed ? "✓" : "✗"}
          </span>{" "}
          {check.check} <span className="opacity-80">(it {check.reason})</span>
        </p>
      ))}
    </div>
  );
}
