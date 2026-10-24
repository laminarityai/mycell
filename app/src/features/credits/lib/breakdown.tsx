// The breakdown under the chart, in two columns: the range's spending by kind of use, and each
// workflow's next to its budget. Pointing at a row shows its series in the chart; clicking it
// keeps that lens.
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatCredits, SPENDING_KIND_LABELS } from "../format";
import {
  type ChartLens as Lens,
  SPENDING_KINDS,
  type SpendingKind,
  type SpendingSummary,
  type WorkflowSpendingLine,
} from "../types";
import { KIND_COLORS, workflowTone } from "./chart-kit";

/** The row pointed at: a kind of use, or a workflow by ID. */
export type Focus = { lens: "kinds"; key: SpendingKind } | { lens: "workflows"; key: string };

type RowEvents = {
  focus: Focus | null;
  onFocus: (focus: Focus | null) => void;
  onPick: (lens: Lens) => void;
};

const ROW =
  "grid h-auto w-full items-center gap-x-3 rounded-md px-2 py-2 text-left font-normal whitespace-normal";

function rowProps(target: Focus, { focus, onFocus, onPick }: RowEvents) {
  const show = () => {
    onFocus(target);
  };
  const hide = () => {
    onFocus(null);
  };
  return {
    variant: "ghost" as const,
    onMouseEnter: show,
    onFocus: show,
    onMouseLeave: hide,
    onBlur: hide,
    onClick: () => {
      onPick(target.lens);
    },
    "aria-pressed": focus?.key === target.key,
  };
}

export function Breakdown({
  summary,
  workflows,
  ...events
}: { summary: SpendingSummary; workflows: WorkflowSpendingLine[] } & RowEvents) {
  const top = Math.max(1, ...SPENDING_KINDS.map((kind) => summary.byKind[kind]));
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <section aria-labelledby="by-kind" className="flex flex-col gap-1">
        <h2 id="by-kind" className="flex items-baseline justify-between px-2 pb-1 font-semibold">
          By kind of use
          <span className="text-sm font-normal text-muted-foreground tabular-nums">
            {formatCredits(summary.spent)} spent
          </span>
        </h2>
        {SPENDING_KINDS.map((kind) => {
          const spent = summary.byKind[kind];
          return (
            <Button
              key={kind}
              {...rowProps({ lens: "kinds", key: kind }, events)}
              className={cn(ROW, "grid-cols-[0.625rem_7rem_minmax(0,1fr)_6.5rem]")}
            >
              <span className={cn("size-2.5 rounded-sm", KIND_COLORS[kind].bg)} />
              <span>{SPENDING_KIND_LABELS[kind]}</span>
              <span className="h-1.5 rounded-full bg-muted">
                <span
                  className={cn("block h-full rounded-full", KIND_COLORS[kind].bg)}
                  style={{ width: `${String((spent / top) * 100)}%` }}
                />
              </span>
              <span className="text-right tabular-nums">
                {formatCredits(spent)}{" "}
                <span className="text-muted-foreground">
                  {summary.spent > 0 ? `${String(Math.round((spent / summary.spent) * 100))}%` : ""}
                </span>
              </span>
            </Button>
          );
        })}
      </section>
      <section aria-labelledby="by-workflow" className="flex flex-col gap-1">
        <h2
          id="by-workflow"
          className="flex items-baseline justify-between px-2 pb-1 font-semibold"
        >
          Workflows against their budgets
          <span className="text-sm font-normal text-muted-foreground">live runs only</span>
        </h2>
        {workflows.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">No workflow has spent any credits.</p>
        ) : null}
        {workflows.map((line, n) => (
          <Button
            key={line.workflowId}
            {...rowProps({ lens: "workflows", key: line.workflowId }, events)}
            className={cn(ROW, "grid-cols-[0.625rem_minmax(0,1fr)_5rem_7rem]")}
          >
            <span className={cn("size-2.5 rounded-full", workflowTone(n).bg)} />
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate">{line.name}</span>
              {line.budgetReached ? (
                <Badge variant="destructive">Paused: budget reached</Badge>
              ) : null}
            </span>
            <BudgetBar line={line} />
            <span className="text-right tabular-nums">
              {formatCredits(line.spent)}
              {line.monthlyBudget === null ? null : (
                <span className="text-muted-foreground">
                  {" "}
                  / {formatCredits(line.monthlyBudget)}
                </span>
              )}
            </span>
          </Button>
        ))}
      </section>
    </div>
  );
}

function BudgetBar({ line }: { line: WorkflowSpendingLine }) {
  const budget = line.monthlyBudget;
  if (budget === null) return <span className="text-xs text-muted-foreground">no budget</span>;
  const share = line.spent / budget;
  return (
    <span className="h-1.5 rounded-full bg-muted">
      <span
        className={cn(
          "block h-full rounded-full",
          line.budgetReached ? "bg-destructive" : share >= 0.7 ? "bg-amber-500" : "bg-foreground",
        )}
        style={{ width: `${String(Math.min(100, share * 100))}%` }}
      />
    </span>
  );
}
