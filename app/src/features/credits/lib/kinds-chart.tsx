// What each day, week or month of the range cost (by the range's length), stacked by kind of
// use in the breakdown's order and colours, so a kind that grew shows as a thicker band.
// `highlight` fades every other kind.
import { cn } from "@/lib/utils";
import { formatCredits, SPENDING_KIND_LABELS } from "../format";
import { bucketUnit, spendingBuckets } from "../range";
import { SPENDING_KINDS, type SpendingKind, type SpendingSummary } from "../types";
import {
  Axes,
  axisDays,
  FRAME,
  type Frame,
  KIND_COLORS,
  niceMax,
  NowLine,
  stretch,
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
  const begun = daysBegun(summary, now);
  const buckets = spendingBuckets(summary.days).filter((bucket) => bucket.first < begun);
  const f: Frame = {
    ...FRAME,
    from: summary.range.from,
    days: axisDays(summary, now),
    yMax: niceMax(Math.max(0, ...buckets.map((bucket) => bucket.spent))),
  };
  return (
    <svg
      viewBox={`0 0 ${String(f.w)} ${String(f.h)}`}
      className="w-full overflow-visible"
      role="img"
      aria-label={`Credits spent each ${bucketUnit(summary.days.length)}, stacked by kind of use`}
    >
      <Axes f={f} />
      {buckets.map((bucket) => {
        const x = xOf(f, bucket.first);
        const width = xOf(f, bucket.first + bucket.days) - x;
        const bar = width * 0.72;
        let base = 0;
        return (
          <g key={bucket.first}>
            <title>
              {[
                stretch(bucket.from, bucket.days),
                ...SPENDING_KINDS.map(
                  (kind) => `${SPENDING_KIND_LABELS[kind]} ${formatCredits(bucket.byKind[kind])}`,
                ),
                `Total ${formatCredits(bucket.spent)}`,
              ].join("\n")}
            </title>
            <rect
              x={x}
              y={f.pad.top}
              width={width}
              height={f.h - f.pad.top - f.pad.bottom}
              className="fill-transparent"
            />
            {SPENDING_KINDS.map((kind) => {
              const y0 = yOf(f, base);
              base += bucket.byKind[kind];
              return (
                <rect
                  key={kind}
                  x={x + (width - bar) / 2}
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
