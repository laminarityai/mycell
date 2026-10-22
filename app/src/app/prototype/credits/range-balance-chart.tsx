"use client";

// PROTOTYPE, throwaway: variant E2's balance lens over any range. Each month's allowance is an
// upward step on the 1st, so the months read as a sawtooth; a stretch at zero is marked as out
// of credits. When the range ends today, the last 7 days' rate carries on dashed to zero over
// the under-7-days band.
import { useState } from "react";
import { CREDITS, NOW } from "../_shared/fixtures";
import { TipRow, Tooltip } from "./chart-kit";
import { fmt } from "./format";
import { grantNote, historyFor, HISTORY_DAYS, MONTH_STARTS } from "./history";
import { dayLabel, includesToday, TODAY_INDEX, type DayRange } from "./range";
import {
  dayBuckets,
  BucketHits,
  indexAt,
  line,
  niceTop,
  RangeAxes,
  xAt,
  yAt,
  type RangeFrame,
} from "./range-kit";
import { domainEnd } from "./range-model";
import { creditScenario, OUT_AT } from "./series";

export function RangeBalanceChart({
  out,
  r,
  frame,
}: {
  out: boolean;
  r: DayRange;
  frame: Omit<RangeFrame, "yMax" | "first" | "end">;
}) {
  const [hit, setHit] = useState<number | null>(null);
  const h = historyFor(out);
  const s = creditScenario(out);
  const now = indexAt(out ? OUT_AT : NOW);
  const live = includesToday(r) && !out;
  const pts: [number, number][] = [];
  for (let i = r.first; i <= r.last; i++) {
    pts.push([i, h.startOfDay[i]]);
    if (h.granted[i] > 0) pts.push([i, h.startOfDay[i] + h.granted[i]]);
    pts.push([i === TODAY_INDEX ? now : i + 1, h.endOfDay[i]]);
  }
  const top = Math.max(...pts.map(([, v]) => v), 1);
  const f: RangeFrame = { ...frame, first: r.first, end: domainEnd(r, out), yMax: niceTop(top) };
  const grants = MONTH_STARTS.map((d, m) => ({ i: indexAt(d), m })).filter(
    (g) => g.i >= r.first && g.i <= r.last,
  );
  const zeros = Array.from({ length: r.last - r.first + 1 }, (_, k) => r.first + k).filter(
    (i) => h.startOfDay[i] === 0 && h.granted[i] === 0 && h.endOfDay[i] === 0,
  );
  const low = CREDITS.lowThresholdDays * s.rate;
  const zeroAt = indexAt(s.zeroAt);
  const day = hit === null ? null : r.first + hit;
  return (
    <div
      className="relative"
      onMouseLeave={() => {
        setHit(null);
      }}
    >
      <svg
        viewBox={`0 0 ${String(f.w)} ${String(f.h)}`}
        className="w-full overflow-visible text-foreground"
        role="img"
        aria-label={`Balance from ${dayLabel(HISTORY_DAYS[r.first], true)} to ${dayLabel(HISTORY_DAYS[r.last], true)}, with each month's allowance as a step up`}
      >
        {live ? (
          <g>
            <rect
              x={f.pad.left}
              y={yAt(f, Math.min(low, f.yMax))}
              width={f.w - f.pad.left - f.pad.right}
              height={yAt(f, 0) - yAt(f, Math.min(low, f.yMax))}
              className="fill-amber-500/10"
            />
            <text
              x={f.w - f.pad.right - 6}
              y={yAt(f, Math.min(low, f.yMax)) + 14}
              textAnchor="end"
              className="fill-amber-700 text-[11px] dark:fill-amber-400"
            >
              Under 7 days left: admins get an alert
            </text>
          </g>
        ) : null}
        <RangeAxes f={f} r={r} />
        {zeros.map((i) => (
          <line
            key={i}
            x1={xAt(f, i)}
            x2={xAt(f, i + 1)}
            y1={yAt(f, 0)}
            y2={yAt(f, 0)}
            className="stroke-destructive"
            strokeWidth={4}
          />
        ))}
        {zeros.length > 0 ? (
          <text
            x={xAt(f, zeros[0])}
            y={yAt(f, 0) - 8}
            textAnchor="middle"
            className="fill-destructive text-[11px] font-medium"
          >
            Out of credits
          </text>
        ) : null}
        {day === null ? null : (
          <line
            x1={xAt(f, day + 0.5)}
            x2={xAt(f, day + 0.5)}
            y1={f.pad.top}
            y2={yAt(f, 0)}
            className="stroke-foreground/30"
          />
        )}
        <polyline
          points={line(f, pts)}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {grants.map((g) => (
          <text
            key={g.i}
            x={xAt(f, g.i) + 4}
            y={yAt(f, h.startOfDay[g.i] + h.granted[g.i]) - 6}
            className="fill-emerald-700 text-[11px] font-medium tabular-nums dark:fill-emerald-400"
          >
            +{fmt(h.granted[g.i])}
          </text>
        ))}
        {live ? (
          <g>
            <line
              x1={xAt(f, now)}
              y1={yAt(f, s.balance)}
              x2={xAt(f, zeroAt)}
              y2={yAt(f, 0)}
              stroke="currentColor"
              strokeWidth={2}
              strokeDasharray="6 5"
            />
            <circle
              cx={xAt(f, zeroAt)}
              cy={yAt(f, 0)}
              r={4.5}
              className="fill-destructive stroke-background"
              strokeWidth={2}
            />
            <text
              x={xAt(f, zeroAt)}
              y={yAt(f, 0) - 12}
              textAnchor="end"
              className="fill-destructive text-[12px] font-medium"
            >
              Zero, {dayLabel(s.zeroAt)}
            </text>
          </g>
        ) : null}
        {includesToday(r) ? (
          <circle
            cx={xAt(f, now)}
            cy={yAt(f, s.balance)}
            r={4.5}
            className={
              out ? "fill-destructive stroke-background" : "fill-foreground stroke-background"
            }
            strokeWidth={2}
          />
        ) : null}
        <BucketHits f={f} buckets={dayBuckets(r)} onHit={setHit} />
      </svg>
      {day === null ? null : (
        <Tooltip f={f} x={xAt(f, day + 0.5)}>
          <p className="pb-1 font-medium">
            {dayLabel(HISTORY_DAYS[day], true)}
            {day === TODAY_INDEX ? " (today)" : ""}
          </p>
          {h.granted[day] > 0 ? (
            <TipRow
              label={grantNote(MONTH_STARTS.findIndex((d) => indexAt(d) === day))}
              value={h.granted[day]}
            />
          ) : null}
          <TipRow label="Spent that day" value={h.daily[day]} />
          <TipRow
            label={day === TODAY_INDEX ? "Balance now" : "Balance at day's end"}
            value={h.endOfDay[day]}
            strong
          />
          {h.endOfDay[day] === 0 ? (
            <p className="pt-1 text-destructive">Out of credits: every workflow paused</p>
          ) : null}
        </Tooltip>
      )}
    </div>
  );
}
