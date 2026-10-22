"use client";

// PROTOTYPE, throwaway: the balance through October: solid where it happened, dashed at the last
// 7 days' rate down to zero, over the band where fewer than 7 days are left. Out of credits, the
// line ends at zero with the moment it got there.
import { useState } from "react";
import { DateTime } from "@/components/date-time";
import { CREDITS, NOW } from "../_shared/fixtures";
import {
  Axes,
  DayHits,
  dayStart,
  NowLine,
  points,
  TipRow,
  Tooltip,
  tick,
  xOf,
  yOf,
  type Frame,
} from "./chart-kit";
import { fmt } from "./format";
import { creditScenario, DAY_MS, DAYS, GRANTED, NEXT_MONTH } from "./series";

export function BalanceChart({ out, frame }: { out: boolean; frame: Omit<Frame, "yMax"> }) {
  const [day, setDay] = useState<number | null>(null);
  const s = creditScenario(out);
  const f: Frame = { ...frame, yMax: GRANTED };
  const low = CREDITS.lowThresholdDays * s.rate;
  const nowAt = s.balances[s.balances.length - 1].at;
  const today = DAYS.length - 1;
  const projectedAt = (at: Date) =>
    Math.max(0, s.balance - (s.rate * (at.getTime() - NOW.getTime())) / DAY_MS);
  const hover = day === null ? null : hoverValue(day);
  const hx = hover === null ? 0 : xOf(f, hover.i === today ? NOW : dayStart(hover.i + 1));

  function hoverValue(i: number) {
    if (i < today) return { i, v: s.balances[i + 1].balance, spent: s.daily[i], projected: false };
    if (i === today) return { i, v: s.balance, spent: s.daily[i], projected: false };
    const end = new Date(Math.min(dayStart(i + 1).getTime(), NEXT_MONTH.getTime()));
    return { i, v: Math.round(projectedAt(end)), spent: s.rate, projected: true };
  }

  return (
    <div
      className="relative"
      onMouseLeave={() => {
        setDay(null);
      }}
    >
      <svg
        viewBox={`0 0 ${String(f.w)} ${String(f.h)}`}
        className="w-full overflow-visible text-foreground"
        role="img"
        aria-label={
          out
            ? `Balance this month, from ${fmt(GRANTED)} on Oct 1 to zero this morning`
            : `Balance this month, from ${fmt(GRANTED)} on Oct 1 to ${fmt(s.balance)} now, reaching zero around ${tick(s.zeroAt)}`
        }
      >
        {out ? null : (
          <g>
            <rect
              x={f.pad.left}
              y={yOf(f, low)}
              width={f.w - f.pad.left - f.pad.right}
              height={yOf(f, 0) - yOf(f, low)}
              className="fill-amber-500/10"
            />
            <text
              x={f.w - f.pad.right - 6}
              y={yOf(f, low) + 14}
              textAnchor="end"
              className="fill-amber-700 text-[11px] dark:fill-amber-400"
            >
              Under 7 days left: admins get an alert
            </text>
          </g>
        )}
        <Axes f={f} />
        <NowLine f={f} at={NOW} />
        {hover ? (
          <line x1={hx} x2={hx} y1={f.pad.top} y2={yOf(f, 0)} className="stroke-foreground/30" />
        ) : null}
        <polyline
          points={points(
            f,
            s.balances.map((b) => ({ at: b.at, v: b.balance })),
          )}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {out ? null : (
          <line
            x1={xOf(f, NOW)}
            y1={yOf(f, s.balance)}
            x2={xOf(f, s.zeroAt)}
            y2={yOf(f, 0)}
            stroke="currentColor"
            strokeWidth={2}
            strokeDasharray="6 5"
          />
        )}
        {out ? null : (
          <g>
            <circle
              cx={xOf(f, NOW)}
              cy={yOf(f, s.balance)}
              r={4.5}
              className="fill-foreground stroke-background"
              strokeWidth={2}
            />
            <text
              x={xOf(f, NOW) + 10}
              y={yOf(f, s.balance) - 10}
              className="fill-foreground text-[12px] font-medium"
            >
              {fmt(s.balance)}
            </text>
          </g>
        )}
        <circle
          cx={xOf(f, s.zeroAt)}
          cy={yOf(f, 0)}
          r={4.5}
          className="fill-destructive stroke-background"
          strokeWidth={2}
        />
        <text
          x={xOf(f, s.zeroAt) + (out ? 8 : 0)}
          y={yOf(f, 0) - 12}
          textAnchor={out ? "start" : "middle"}
          className="fill-destructive text-[12px] font-medium"
        >
          {out ? "Out of credits" : `Zero, ${tick(s.zeroAt)}`}
        </text>
        <DayHits f={f} days={out ? DAYS.length : 31} onDay={setDay} />
        {hover ? (
          <circle
            cx={hx}
            cy={yOf(f, hover.v)}
            r={4}
            className="pointer-events-none fill-background stroke-foreground"
            strokeWidth={2}
          />
        ) : null}
      </svg>
      {hover ? (
        <Tooltip f={f} x={hx}>
          <p className="pb-1 font-medium">
            <DateTime value={dayStart(hover.i)} day />
            {hover.projected ? " (projected)" : hover.i === today ? " (today)" : ""}
          </p>
          <TipRow
            label={hover.i === today ? "Balance now" : "Balance at day's end"}
            value={hover.v}
          />
          <TipRow
            label={hover.projected ? "At this week's rate" : "Spent that day"}
            value={hover.spent}
          />
        </Tooltip>
      ) : null}
      {out ? (
        <p className="pt-1 text-xs text-destructive">
          Reached zero at <DateTime value={nowAt} />. Every workflow is paused.
        </p>
      ) : null}
    </div>
  );
}
