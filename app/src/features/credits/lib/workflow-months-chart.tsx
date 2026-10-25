// Across months: one row per workflow. Budgets are monthly, so each row draws its live-run
// spending for each month as a running total that starts again on the 1st, under that month's
// budget (dashed), with a red dot where it reached it and paused until the next 1st. Each row
// has its own scale, so the eye compares a workflow with its budget, not with the others.
import { cn } from "@/lib/utils";
import { formatCredits } from "../format";
import type { SpendingSummary, WorkflowSpendingLine } from "../types";
import { axisDays, DateTicks, FRAME, type Frame, tick, workflowTone, xOf } from "./chart-kit";
import { dayOf, daysBegun, nowDay } from "./series";

const ROW = 74;
const TITLE = 18;

/** The range's days split into calendar months: each one's first and last day index. */
function monthsOf(summary: SpendingSummary): { first: number; last: number }[] {
  const months: { first: number; last: number }[] = [];
  summary.days.forEach((day, i) => {
    const current = months.at(-1);
    if (current === undefined || day.day.getUTCDate() === 1) months.push({ first: i, last: i });
    else current.last = i;
  });
  return months;
}

export function WorkflowMonthsChart({
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
  if (workflows.length === 0) {
    return <p className="text-sm text-muted-foreground">No workflow spent any credits.</p>;
  }
  const begun = daysBegun(summary, now);
  const at = nowDay(summary, now);
  const months = monthsOf(summary);
  const f: Frame = {
    ...FRAME,
    h: FRAME.pad.top + workflows.length * ROW + FRAME.pad.bottom,
    from: summary.range.from,
    days: axisDays(summary, now),
    yMax: 1,
  };
  // A day ends at its next day's start, or now for today.
  const endOf = (i: number) => Math.min(i + 1, at);
  return (
    <svg
      viewBox={`0 0 ${String(f.w)} ${String(f.h)}`}
      className="w-full overflow-visible"
      role="img"
      aria-label="Each workflow's spending for each month as a running total, against its budget"
    >
      {months.slice(1).map((month) => (
        <line
          key={month.first}
          x1={xOf(f, month.first)}
          x2={xOf(f, month.first)}
          y1={f.pad.top}
          y2={f.h - f.pad.bottom}
          className="stroke-border"
        />
      ))}
      {workflows.map((line, n) => {
        const tone = workflowTone(n);
        const totals = line.monthToDate.slice(0, begun);
        const budget = line.monthlyBudget;
        const peak = Math.max(1, budget ?? 0, line.monthBefore, ...totals) * 1.1;
        const top = f.pad.top + n * ROW + TITLE;
        const base = f.pad.top + (n + 1) * ROW - 8;
        const y = (v: number) => base - (v / peak) * (base - top);
        const reached = line.reachedOn.map((day) => tick(day)).join(", ");
        return (
          <g
            key={line.workflowId}
            className={cn(
              "transition-opacity",
              highlight !== null && highlight !== line.workflowId && "opacity-20",
            )}
          >
            <text x={f.pad.left} y={top - 6} className="fill-foreground text-[12px] font-medium">
              {line.name}
              <tspan className="fill-muted-foreground font-normal tabular-nums">
                {"  "}
                {formatCredits(line.spent)} in this range
                {reached === "" ? "" : `, reached its budget ${reached}`}
              </tspan>
            </text>
            {budget === null ? null : (
              <text
                x={f.w - f.pad.right}
                y={top - 6}
                textAnchor="end"
                className="fill-muted-foreground text-[11px] tabular-nums"
              >
                Budget {formatCredits(budget)} a month
              </text>
            )}
            <line
              x1={f.pad.left}
              x2={f.w - f.pad.right}
              y1={base}
              y2={base}
              className="stroke-muted-foreground/40"
            />
            {months.map((month) => {
              const last = Math.min(month.last, begun - 1);
              if (last < month.first) return null;
              const days = Array.from(
                { length: last - month.first + 1 },
                (_, k) => month.first + k,
              );
              const start = month.first === 0 ? line.monthBefore : 0;
              return (
                <g key={month.first}>
                  {budget === null ? null : (
                    <line
                      x1={xOf(f, month.first)}
                      x2={xOf(f, month.last + 1)}
                      y1={y(budget)}
                      y2={y(budget)}
                      className={tone.stroke}
                      strokeWidth={1.25}
                      strokeDasharray="4 3"
                    />
                  )}
                  <polyline
                    points={[
                      [month.first, start] as const,
                      ...days.map((i) => [endOf(i), totals[i] ?? 0] as const),
                    ]
                      .map(([day, v]) => `${String(xOf(f, day))},${String(y(v))}`)
                      .join(" ")}
                    fill="none"
                    className={tone.stroke}
                    strokeWidth={1.75}
                    strokeLinejoin="round"
                  />
                </g>
              );
            })}
            {line.reachedOn.map((day) => {
              const i = Math.round(dayOf(summary, day));
              return (
                <circle
                  key={i}
                  cx={xOf(f, endOf(i))}
                  cy={y(totals[i] ?? 0)}
                  r={3.5}
                  className="fill-destructive stroke-background"
                  strokeWidth={1.5}
                >
                  <title>{`${line.name} reached its budget on ${tick(day)} and paused until the 1st`}</title>
                </circle>
              );
            })}
          </g>
        );
      })}
      <DateTicks f={f} />
    </svg>
  );
}
