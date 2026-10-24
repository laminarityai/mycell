"use client";

// One chart and its lenses: a segmented control picks what it plots (the balance with its
// grants and projection, spending stacked by kind, or each workflow's month against its
// budget), and the breakdown underneath drives it too. What each lens says follows the range.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { bucketUnit, includesNow, withinOneMonth } from "../range";
import type { ChartLens as Lens, Runway, SpendingSummary, WorkflowSpendingLine } from "../types";
import { BalanceChart } from "./balance-chart";
import { Breakdown, type Focus } from "./breakdown";
import { KindsChart } from "./kinds-chart";
import { WorkflowMonthsChart } from "./workflow-months-chart";
import { WorkflowsChart } from "./workflows-chart";

const LENSES: { key: Lens; label: string }[] = [
  { key: "balance", label: "Balance" },
  { key: "kinds", label: "Spending by kind" },
  { key: "workflows", label: "Spending by workflow" },
];

/** A lens's title and note over this range. */
function lensText(lens: Lens, summary: SpendingSummary, now: Date) {
  if (lens === "balance") {
    const projected = includesNow(summary.range, now)
      ? " Dashed: this week's rate carried forward to zero."
      : "";
    return {
      title: "Balance",
      note: `Solid: at the end of each day (UTC), each grant a step up.${projected}`,
    };
  }
  if (lens === "kinds") {
    return {
      title: `Spent each ${bucketUnit(summary.days.length)}, by kind of use`,
      note: "Stacked in the order of the list below. A band that thickens is a kind that grew.",
    };
  }
  return withinOneMonth(summary.range)
    ? {
        title: "Each workflow's running total for the month, against its budget",
        note: "Live runs only. Dashed: the workflow's monthly budget. A red dot: it reached it and paused.",
      }
    : {
        title: "Each workflow, month by month, against its budget",
        note: "Live runs only. Budgets are monthly, so each line starts again on the 1st under its budget (dashed). A red dot: it reached it and paused until the 1st. Each row has its own scale.",
      };
}

export function LensPanel({
  summary,
  runway,
  workflows,
  now,
  initialLens = "balance",
}: {
  summary: SpendingSummary;
  runway: Runway;
  workflows: WorkflowSpendingLine[];
  now: Date;
  initialLens?: Lens;
}) {
  const [lens, setLens] = useState<Lens>(initialLens);
  const [focus, setFocus] = useState<Focus | null>(null);
  const shown = focus?.lens ?? lens;
  const text = lensText(shown, summary, now);
  const highlight = focus?.lens === "workflows" ? focus.key : null;
  return (
    <div className="flex flex-col gap-8">
      <section aria-label="Over time" className="flex flex-col gap-4 rounded-lg border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex max-w-2xl flex-col gap-0.5">
            <h2 className="font-semibold">{text.title}</h2>
            <p className="text-xs text-muted-foreground">{text.note}</p>
          </div>
          <div role="group" aria-label="Plot" className="inline-flex rounded-lg bg-muted p-[3px]">
            {LENSES.map((l) => (
              <Button
                key={l.key}
                variant="ghost"
                size="sm"
                aria-pressed={lens === l.key}
                onClick={() => {
                  setLens(l.key);
                }}
                className={cn(
                  "text-muted-foreground",
                  lens === l.key && "bg-background text-foreground shadow-xs",
                  shown === l.key && lens !== l.key && "text-foreground ring-1 ring-border",
                )}
              >
                {l.label}
              </Button>
            ))}
          </div>
        </div>
        {shown === "balance" ? (
          <BalanceChart summary={summary} runway={runway} now={now} />
        ) : shown === "kinds" ? (
          <KindsChart
            summary={summary}
            now={now}
            highlight={focus?.lens === "kinds" ? focus.key : null}
          />
        ) : withinOneMonth(summary.range) ? (
          <WorkflowsChart summary={summary} workflows={workflows} now={now} highlight={highlight} />
        ) : (
          <WorkflowMonthsChart
            summary={summary}
            workflows={workflows}
            now={now}
            highlight={highlight}
          />
        )}
      </section>
      <div className="flex flex-col gap-2">
        <Breakdown
          summary={summary}
          workflows={workflows}
          focus={focus}
          onFocus={setFocus}
          onPick={setLens}
        />
        <p className="px-2 text-xs text-muted-foreground">
          Point at a kind or a workflow to see it in the chart; click it to keep that view.
        </p>
      </div>
    </div>
  );
}
