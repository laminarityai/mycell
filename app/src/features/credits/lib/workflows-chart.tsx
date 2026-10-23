// Each workflow's live-run spending as a running total, with its budget as a dashed line in the
// same tone, so how close each came, and when, is the gap between them. A red dot marks the day
// one reached its budget and paused. Direct labels name each line; `highlight` fades the rest.
import { cn } from "@/lib/utils";
import { formatCredits } from "../format";
import type { SpendingSummary, WorkflowSpendingLine } from "../types";
import {
  Axes,
  FRAME,
  type Frame,
  niceMax,
  NowLine,
  points,
  xOf,
  yOf,
  workflowTone,
} from "./chart-kit";
import { daysBegun, nowDay, runningTotals } from "./series";

export function WorkflowsChart({
  summary,
  workflows,
  now,
  highlight,
}: {
  summary: SpendingSummary;
  workflows: WorkflowSpendingLine[];
  now: Date;
  highlight: string | null;
}) {
  const begun = daysBegun(summary, now);
  const at = nowDay(summary, now);
  const top = Math.max(
    0,
    ...workflows.map((line) => Math.max(line.spent, line.monthlyBudget ?? 0)),
  );
  const f: Frame = {
    ...FRAME,
    pad: { ...FRAME.pad, right: 150 },
    from: summary.range.from,
    days: summary.days.length,
    yMax: niceMax(top),
  };
  // A day ends at its next day's start, or now for today.
  const endOf = (i: number) => Math.min(i + 1, at);
  return (
    <svg
      viewBox={`0 0 ${String(f.w)} ${String(f.h)}`}
      className="w-full overflow-visible"
      role="img"
      aria-label="Each workflow's spending as a running total, against its budget"
    >
      <Axes f={f} />
      <NowLine f={f} day={at} />
      {workflows.map((line, n) => {
        const tone = workflowTone(n);
        const totals = runningTotals(line.daily, begun);
        const budget = line.monthlyBudget;
        const reachedOn = budget === null ? -1 : totals.findIndex((total) => total >= budget);
        return (
          <g
            key={line.workflowId}
            className={cn(
              "transition-opacity",
              highlight !== null && highlight !== line.workflowId && "opacity-15",
            )}
          >
            <title>{`${line.name}: ${formatCredits(line.spent)}${budget === null ? "" : ` of ${formatCredits(budget)}`}`}</title>
            {budget === null ? null : (
              <g>
                <line
                  x1={xOf(f, 0)}
                  x2={xOf(f, f.days)}
                  y1={yOf(f, budget)}
                  y2={yOf(f, budget)}
                  className={tone.stroke}
                  strokeWidth={1.25}
                  strokeDasharray="5 4"
                />
                <text
                  x={xOf(f, f.days) + 6}
                  y={yOf(f, budget) + 4}
                  className="fill-muted-foreground text-[11px]"
                >
                  Budget {formatCredits(budget)}
                </text>
              </g>
            )}
            <polyline
              points={points(f, [
                [0, 0],
                ...totals.map((total, i): [number, number] => [endOf(i), total]),
              ])}
              fill="none"
              className={tone.stroke}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            {reachedOn < 0 ? null : (
              <circle
                cx={xOf(f, endOf(reachedOn))}
                cy={yOf(f, totals[reachedOn] ?? 0)}
                r={4}
                className="fill-destructive stroke-background"
                strokeWidth={2}
              >
                <title>{`${line.name} reached its budget and paused`}</title>
              </circle>
            )}
            <text
              x={xOf(f, Math.min(at, f.days)) + 8}
              y={yOf(f, line.spent) + 4}
              className="fill-foreground stroke-background text-[11px]"
              strokeWidth={3}
              paintOrder="stroke"
            >
              {line.name}{" "}
              <tspan className="fill-muted-foreground tabular-nums">
                {formatCredits(line.spent)}
                {line.budgetReached ? ", paused" : ""}
              </tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}
