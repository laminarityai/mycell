// PROTOTYPE, throwaway: variant B's pieces: the month as one stacked bar by kind of use, and each
// workflow's spending as a meter against its budget.
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Workflow } from "../_shared/fixtures";
import { GROUP_COLOR, MONTH_GROUPS, MONTH_TOTAL } from "./fixtures";
import { fmt } from "./format";

const pct = (part: number, whole: number) => `${String(Math.round((part / whole) * 1000) / 10)}%`;

export function MonthBar() {
  return (
    <div className="flex flex-col gap-4">
      <div
        className="flex h-9 w-full gap-0.5 overflow-hidden rounded-md"
        role="img"
        aria-label={`This month's ${fmt(MONTH_TOTAL)} credits by kind of use`}
      >
        {MONTH_GROUPS.map((g) => (
          <div
            key={g.key}
            title={`${g.label}: ${fmt(g.credits)} credits (${pct(g.credits, MONTH_TOTAL)})`}
            className={cn("h-full min-w-1", GROUP_COLOR[g.key])}
            style={{ width: pct(g.credits, MONTH_TOTAL) }}
          />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        {MONTH_GROUPS.map((g) => (
          <li key={g.key} className="flex gap-2">
            <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-sm", GROUP_COLOR[g.key])} />
            <span className="flex flex-col">
              <span>
                <span className="font-medium">{g.label}</span>{" "}
                <span className="text-muted-foreground tabular-nums">
                  {fmt(g.credits)} ({pct(g.credits, MONTH_TOTAL)})
                </span>
              </span>
              <span className="text-xs text-muted-foreground">{g.help}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One workflow's month against its budget. Over budget fills the track and turns red. */
export function BudgetMeter({ workflow, scale }: { workflow: Workflow; scale: number }) {
  const { budget, spentThisMonth: spent } = workflow;
  const reached = budget !== null && spent >= budget;
  const near = budget !== null && !reached && spent / budget >= 0.7;
  return (
    <li className="grid grid-cols-1 gap-2 py-4 sm:grid-cols-[16rem_minmax(0,1fr)_9rem] sm:items-center sm:gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/prototype/workflow-status" className="font-medium hover:underline">
          {workflow.name}
        </Link>
        {workflow.paused === "budget_reached" ? (
          <Badge variant="destructive">Paused: budget reached</Badge>
        ) : workflow.paused === "failures" ? (
          <Badge variant="outline">Paused: failing</Badge>
        ) : null}
      </div>
      {budget === null ? (
        <div className="flex flex-col gap-1">
          <div className="h-2 rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-foreground/40"
              style={{ width: pct(spent, scale) }}
            />
          </div>
          <span className="text-xs text-muted-foreground">
            No budget: only the company&rsquo;s balance limits it.
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="h-2 rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full",
                reached ? "bg-destructive" : near ? "bg-amber-500" : "bg-foreground",
              )}
              style={{ width: pct(Math.min(spent, budget), budget) }}
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {reached
              ? "Reached. Resumes on the 1st (UTC), or at once if you raise or remove the budget."
              : `${fmt(budget - spent)} left this month`}
          </span>
        </div>
      )}
      <span className="text-sm tabular-nums sm:text-right">
        {fmt(spent)}
        <span className="text-muted-foreground">
          {budget === null ? " spent" : ` of ${fmt(budget)}`}
        </span>
      </span>
    </li>
  );
}
