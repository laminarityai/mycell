// What each day of the range cost, stacked by kind of use in the breakdown's order and colours,
// so a kind that grew shows as a thicker band. `highlight` fades every other kind.
import { cn } from "@/lib/utils";
import { formatCredits, SPENDING_KIND_LABELS } from "../format";
import { SPENDING_KINDS, type SpendingKind, type SpendingSummary } from "../types";
import {
  Axes,
  dayW,
  FRAME,
  type Frame,
  KIND_COLORS,
  niceMax,
  NowLine,
  tick,
  xOf,
  yOf,
} from "./chart-kit";
import { daysBegun, nowDay } from "./series";

export function KindsChart({
  summary,
  now,
  highlight,
}: {
  summary: SpendingSummary;
  now: Date;
  highlight: SpendingKind | null;
}) {
  const days = summary.days.slice(0, daysBegun(summary, now));
  const f: Frame = {
    ...FRAME,
    from: summary.range.from,
    days: summary.days.length,
    yMax: niceMax(Math.max(0, ...days.map((day) => day.spent))),
  };
  const bar = dayW(f) * 0.72;
  return (
    <svg
      viewBox={`0 0 ${String(f.w)} ${String(f.h)}`}
      className="w-full overflow-visible"
      role="img"
      aria-label="Credits spent each day, stacked by kind of use"
    >
      <Axes f={f} />
      {days.map((day, i) => {
        let base = 0;
        return (
          <g key={day.day.getTime()}>
            <title>
              {[
                tick(day.day),
                ...SPENDING_KINDS.map(
                  (kind) => `${SPENDING_KIND_LABELS[kind]} ${formatCredits(day.byKind[kind])}`,
                ),
                `Total ${formatCredits(day.spent)}`,
              ].join("\n")}
            </title>
            <rect
              x={xOf(f, i)}
              y={f.pad.top}
              width={dayW(f)}
              height={f.h - f.pad.top - f.pad.bottom}
              className="fill-transparent"
            />
            {SPENDING_KINDS.map((kind) => {
              const y0 = yOf(f, base);
              base += day.byKind[kind];
              return (
                <rect
                  key={kind}
                  x={xOf(f, i) + (dayW(f) - bar) / 2}
                  y={yOf(f, base)}
                  width={bar}
                  height={Math.max(0, y0 - yOf(f, base))}
                  className={cn(
                    KIND_COLORS[kind].fill,
                    "stroke-background transition-opacity",
                    highlight !== null && highlight !== kind && "opacity-20",
                  )}
                  strokeWidth={1}
                />
              );
            })}
          </g>
        );
      })}
      <NowLine f={f} day={nowDay(summary, now)} />
    </svg>
  );
}
