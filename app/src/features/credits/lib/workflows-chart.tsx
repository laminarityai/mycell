// Within one month: each workflow's live-run spending for the month as a running total (from
// what it spent before the range, if it starts after the 1st), with its budget as a dashed line
// in the same tone, so how close each came, and when, is the gap between them. A red dot marks
// the day one reached its budget and paused. Direct labels name each line; `highlight` fades
// the rest. A range across months is drawn by `WorkflowMonthsChart`.
import { cn } from "@/lib/utils";
import { formatCredits } from "../format";
import type { SpendingSummary, WorkflowSpendingLine } from "../types";
import {
  Axes,
  axisDays,
  FRAME,
  type Frame,
  niceMax,
  NowLine,
  points,
  xOf,
  yOf,
  workflowTone,
} from "./chart-kit";
import { dayOf, daysBegun, nowDay } from "./series";

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
    ...workflows.map((line) =>
      Math.max(line.monthBefore, ...line.monthToDate.slice(0, begun), line.monthlyBudget ?? 0),
    ),
  );
  const f: Frame = {
    ...FRAME,
    pad: { ...FRAME.pad, right: 150 },
    from: summary.range.from,
    days: axisDays(summary, now),
    yMax: niceMax(top),
  };
  // A day ends at its next day's start, or now for today.
  const endOf = (i: number) => Math.min(i + 1, at);
  return (
    <svg
      viewBox={`0 0 ${String(f.w)} ${String(f.h)}`}
      className="w-full overflow-visible"
      role="img"
      aria-label="Each workflow's spending for the month as a running total, against its budget"
    >
      <Axes f={f} />
      <NowLine f={f} day={at} />
      {workflows.map((line, n) => {
        const tone = workflowTone(n);
        const totals = line.monthToDate.slice(0, begun);
        const soFar = totals.at(-1) ?? line.monthBefore;
        const budget = line.monthlyBudget;
        return (
          <g
            key={line.workflowId}
            className={cn(
              "transition-opacity",
              highlight !== null && highlight !== line.workflowId && "opacity-15",
            )}
          >
            <title>{`${line.name}: ${formatCredits(soFar)}${budget === null ? "" : ` of ${formatCredits(budget)}`}`}</title>
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
                [0, line.monthBefore],
                ...totals.map((total, i): [number, number] => [endOf(i), total]),
              ])}
              fill="none"
              className={tone.stroke}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            {line.reachedOn.map((day) => {
              const i = Math.round(dayOf(summary, day));
              return (
                <circle
                  key={i}
                  cx={xOf(f, endOf(i))}
                  cy={yOf(f, totals[i] ?? 0)}
                  r={4}
                  className="fill-destructive stroke-background"
                  strokeWidth={2}
                >
                  <title>{`${line.name} reached its budget and paused`}</title>
                </circle>
              );
            })}
            <text
              x={xOf(f, Math.min(at, summary.days.length)) + 8}
              y={yOf(f, soFar) + 4}
              className="fill-foreground stroke-background text-[11px]"
              strokeWidth={3}
              paintOrder="stroke"
            >
              {line.name}{" "}
              <tspan className="fill-muted-foreground tabular-nums">
                {formatCredits(soFar)}
                {line.budgetReached ? ", paused" : ""}
              </tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}
