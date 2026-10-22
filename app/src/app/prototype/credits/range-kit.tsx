// PROTOTYPE, throwaway: variant E2's time axis. Like chart-kit's, but over any range of days
// (positions are day indexes into the history), with ticks that suit the span: weekly for a
// month, the 1st of each month for longer.
import { fmt } from "./format";
import type { Frame } from "./chart-kit";
import { HISTORY_DAYS, HISTORY_START, MONTH_STARTS } from "./history";
import { dayLabel, monthLabel, type DayRange } from "./range";
import { DAY_MS } from "./series";

/** A frame over day indexes `first` (inclusive) to `end` (exclusive, may be fractional). */
export type RangeFrame = Frame & { first: number; end: number };

export const indexAt = (d: Date) => (d.getTime() - HISTORY_START.getTime()) / DAY_MS;
export const xAt = (f: RangeFrame, i: number) =>
  f.pad.left + ((i - f.first) / (f.end - f.first)) * (f.w - f.pad.left - f.pad.right);
export const yAt = (f: RangeFrame, v: number) =>
  f.pad.top + (1 - v / f.yMax) * (f.h - f.pad.top - f.pad.bottom);

/** The smallest of 4 even gridline steps (1, 2, 2.5 or 5 × 10ⁿ) that holds `v`. */
export function niceTop(v: number) {
  const unit = 10 ** Math.floor(Math.log10(Math.max(v, 1) / 4));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * unit).find((s) => s * 4 >= v) ?? unit * 10;
  return step * 4;
}

export const line = (f: RangeFrame, pts: [number, number][]) =>
  pts.map(([i, v]) => `${String(xAt(f, i))},${String(yAt(f, v))}`).join(" ");

/** Where tick labels go: each week from the first day for short ranges, else each month. */
export function ticksFor(r: DayRange): { i: number; label: string }[] {
  const days = r.last - r.first + 1;
  if (days <= 45) {
    return Array.from({ length: Math.ceil(days / 7) }, (_, k) => r.first + k * 7).map((i) => ({
      i: i + 0.5,
      label: dayLabel(HISTORY_DAYS[i]),
    }));
  }
  const starts = MONTH_STARTS.map(indexAt).filter((i) => i >= r.first && i <= r.last);
  const every = starts.length > 7 ? 2 : 1;
  return starts
    .filter((_, k) => k % every === 0)
    .map((i, k) => {
      const d = HISTORY_DAYS[i];
      return { i, label: monthLabel(d, k === 0 || d.getUTCMonth() === 0) };
    });
}

export function RangeAxes({ f, r, steps = 4 }: { f: RangeFrame; r: DayRange; steps?: number }) {
  const values = Array.from({ length: steps + 1 }, (_, k) => (f.yMax / steps) * k);
  return (
    <g className="text-[11px]">
      {values.map((v) => (
        <g key={v}>
          <line
            x1={f.pad.left}
            x2={f.w - f.pad.right}
            y1={yAt(f, v)}
            y2={yAt(f, v)}
            className={v === 0 ? "stroke-muted-foreground/50" : "stroke-border"}
          />
          <text
            x={f.pad.left - 8}
            y={yAt(f, v) + 4}
            textAnchor="end"
            className="fill-muted-foreground tabular-nums"
          >
            {fmt(v)}
          </text>
        </g>
      ))}
      <XTicks f={f} r={r} />
    </g>
  );
}

export function XTicks({ f, r }: { f: RangeFrame; r: DayRange }) {
  return (
    <g className="text-[11px]">
      {ticksFor(r).map((t) => (
        <text
          key={t.i}
          x={xAt(f, t.i)}
          y={f.h - 8}
          textAnchor="middle"
          className="fill-muted-foreground"
        >
          {t.label}
        </text>
      ))}
    </g>
  );
}

/** Transparent columns, one per bucket of days, reporting which the pointer is over. */
export function BucketHits({
  f,
  buckets,
  onHit,
  top = f.pad.top,
  bottom = f.h - f.pad.bottom,
}: {
  f: RangeFrame;
  buckets: { first: number; last: number }[];
  onHit: (k: number) => void;
  top?: number;
  bottom?: number;
}) {
  return (
    <g>
      {buckets.map((b, k) => (
        <rect
          key={b.first}
          x={xAt(f, b.first)}
          y={top}
          width={xAt(f, b.last + 1) - xAt(f, b.first)}
          height={bottom - top}
          className="fill-transparent"
          onMouseEnter={() => {
            onHit(k);
          }}
        />
      ))}
    </g>
  );
}

/** Each day of the range as its own bucket. */
export const dayBuckets = (r: DayRange) =>
  Array.from({ length: r.last - r.first + 1 }, (_, k) => ({
    first: r.first + k,
    last: r.first + k,
  }));
