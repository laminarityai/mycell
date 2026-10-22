"use client";

// PROTOTYPE, throwaway: variant E2's spending-by-kind lens: stacked bars per day, week or month
// (by the range's span), in round 1's order and colours. `highlight` fades the other kinds.
import { useState } from "react";
import { cn } from "@/lib/utils";
import { KIND_FILL, TipRow, Tooltip } from "./chart-kit";
import { GROUP_COLOR, MONTH_GROUPS } from "./fixtures";
import { historyFor } from "./history";
import { includesToday, TODAY_INDEX, type DayRange } from "./range";
import { BucketHits, niceTop, RangeAxes, xAt, yAt, type RangeFrame } from "./range-kit";
import { bucketsFor, domainEnd, sumIn } from "./range-model";
import { KIND_ORDER, type KindKey } from "./series";

const LABEL = Object.fromEntries(MONTH_GROUPS.map((g) => [g.key, g.label]));

export function RangeKindsChart({
  out,
  r,
  frame,
  highlight = null,
}: {
  out: boolean;
  r: DayRange;
  frame: Omit<RangeFrame, "yMax" | "first" | "end">;
  highlight?: KindKey | null;
}) {
  const [hit, setHit] = useState<number | null>(null);
  const h = historyFor(out);
  const buckets = bucketsFor(r).map((b) => ({
    ...b,
    kinds: KIND_ORDER.map((k) => sumIn(h.kinds[k], b.first, b.last)),
  }));
  const totals = buckets.map((b) => b.kinds.reduce((a, c) => a + c, 0));
  const f: RangeFrame = {
    ...frame,
    first: r.first,
    end: domainEnd(r, out),
    yMax: niceTop(Math.max(...totals, 1) * 1.05),
  };
  const b = hit === null ? null : buckets[hit];
  const unit = buckets.length > 0 && buckets[0].first === buckets[0].last ? "day" : "bucket";
  return (
    <div
      className="relative"
      onMouseLeave={() => {
        setHit(null);
      }}
    >
      <svg
        viewBox={`0 0 ${String(f.w)} ${String(f.h)}`}
        className="w-full overflow-visible"
        role="img"
        aria-label={`Credits spent each ${unit === "day" ? "day" : "period"}, stacked by kind of use`}
      >
        <RangeAxes f={f} r={r} />
        {b === null ? null : (
          <rect
            x={xAt(f, b.first)}
            y={f.pad.top}
            width={xAt(f, b.last + 1) - xAt(f, b.first)}
            height={yAt(f, 0) - f.pad.top}
            className="fill-muted"
          />
        )}
        {buckets.map((bucket) => {
          const x0 = xAt(f, bucket.first);
          const width = xAt(f, bucket.last + 1) - x0;
          const inset = Math.min(width * 0.14, 6);
          let base = 0;
          return (
            <g key={bucket.first}>
              {KIND_ORDER.map((k, n) => {
                const y0 = yAt(f, base);
                base += bucket.kinds[n];
                return (
                  <rect
                    key={k}
                    x={x0 + inset}
                    y={yAt(f, base)}
                    width={Math.max(1, width - inset * 2)}
                    height={Math.max(0, y0 - yAt(f, base))}
                    className={cn(
                      KIND_FILL[k],
                      "stroke-background transition-opacity",
                      highlight !== null && highlight !== k && "opacity-20",
                    )}
                    strokeWidth={1}
                  />
                );
              })}
            </g>
          );
        })}
        {includesToday(r) && f.end > TODAY_INDEX + 1 ? (
          <text
            x={(xAt(f, TODAY_INDEX + 1) + f.w - f.pad.right) / 2}
            y={yAt(f, 0) - 10}
            textAnchor="middle"
            className="fill-muted-foreground text-[11px]"
          >
            Still to come
          </text>
        ) : null}
        <BucketHits f={f} buckets={buckets} onHit={setHit} />
      </svg>
      {b === null || hit === null ? null : (
        <Tooltip f={f} x={xAt(f, b.last + 1)}>
          <p className="pb-1 font-medium">
            {b.label}
            {b.last === TODAY_INDEX ? " (so far)" : ""}
          </p>
          {[...KIND_ORDER].reverse().map((k) => (
            <TipRow
              key={k}
              swatch={GROUP_COLOR[k]}
              label={LABEL[k]}
              value={b.kinds[KIND_ORDER.indexOf(k)]}
            />
          ))}
          <TipRow label="Total" value={totals[hit]} strong />
        </Tooltip>
      )}
    </div>
  );
}
