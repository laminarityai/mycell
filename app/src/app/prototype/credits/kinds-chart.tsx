"use client";

// PROTOTYPE, throwaway: what each day of October cost, stacked by kind of use in the same order
// and colours as the month bar, so a kind that grew shows as a thicker band. `highlight` fades
// every other kind (the breakdown below the chart sets it on hover).
import { useState } from "react";
import { DateTime } from "@/components/date-time";
import { cn } from "@/lib/utils";
import { NOW } from "../_shared/fixtures";
import {
  Axes,
  DayHits,
  dayStart,
  dayW,
  KIND_FILL,
  MONTH_DAYS,
  NowLine,
  niceMax,
  TipRow,
  Tooltip,
  xOf,
  yOf,
  type Frame,
} from "./chart-kit";
import { GROUP_COLOR, MONTH_GROUPS } from "./fixtures";
import { creditScenario, DAYS, KIND_ORDER, type KindKey } from "./series";

const LABEL = Object.fromEntries(MONTH_GROUPS.map((g) => [g.key, g.label]));

export function KindsChart({
  out,
  frame,
  highlight = null,
}: {
  out: boolean;
  frame: Omit<Frame, "yMax">;
  highlight?: KindKey | null;
}) {
  const [day, setDay] = useState<number | null>(null);
  const s = creditScenario(out);
  const f: Frame = { ...frame, yMax: niceMax(Math.max(...s.daily)) };
  const bw = dayW(f) * 0.72;
  return (
    <div
      className="relative"
      onMouseLeave={() => {
        setDay(null);
      }}
    >
      <svg
        viewBox={`0 0 ${String(f.w)} ${String(f.h)}`}
        className="w-full overflow-visible"
        role="img"
        aria-label="Credits spent each day this month, stacked by kind of use"
      >
        <Axes f={f} />
        {day === null ? null : (
          <rect
            x={xOf(f, dayStart(day))}
            y={f.pad.top}
            width={dayW(f)}
            height={yOf(f, 0) - f.pad.top}
            className="fill-muted"
          />
        )}
        {DAYS.map((d, i) => {
          let base = 0;
          return (
            <g key={d.getTime()}>
              {KIND_ORDER.map((k) => {
                const v = s.kinds[k][i];
                const y0 = yOf(f, base);
                base += v;
                return (
                  <rect
                    key={k}
                    x={xOf(f, d) + (dayW(f) - bw) / 2}
                    y={yOf(f, base)}
                    width={bw}
                    height={Math.max(0, y0 - yOf(f, base))}
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
        <NowLine f={f} at={NOW} />
        {out ? null : (
          <text
            x={(xOf(f, NOW) + f.w - f.pad.right) / 2}
            y={yOf(f, 0) - 10}
            textAnchor="middle"
            className="fill-muted-foreground text-[11px]"
          >
            Rest of October
          </text>
        )}
        <DayHits f={f} days={Math.min(DAYS.length, MONTH_DAYS)} onDay={setDay} />
      </svg>
      {day === null ? null : (
        <Tooltip f={f} x={xOf(f, dayStart(day)) + dayW(f)}>
          <p className="pb-1 font-medium">
            <DateTime value={dayStart(day)} day />
            {day === DAYS.length - 1 ? " (so far)" : ""}
          </p>
          {[...KIND_ORDER].reverse().map((k) => (
            <TipRow key={k} swatch={GROUP_COLOR[k]} label={LABEL[k]} value={s.kinds[k][day]} />
          ))}
          <TipRow label="Total" value={s.daily[day]} strong />
        </Tooltip>
      )}
    </div>
  );
}
