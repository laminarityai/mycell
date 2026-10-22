"use client";

// PROTOTYPE, throwaway: each workflow's spending this month as a running total, with its budget
// as a dashed line in the same tone, so how close each came, and when, is the gap between them.
// Direct labels name each line; `highlight` fades every other workflow.
import { useState } from "react";
import { DateTime } from "@/components/date-time";
import { cn } from "@/lib/utils";
import { NOW } from "../_shared/fixtures";
import {
  Axes,
  DayHits,
  dayStart,
  NowLine,
  niceMax,
  points,
  TipRow,
  Tooltip,
  WORKFLOW_TONES,
  xOf,
  yOf,
  type Frame,
} from "./chart-kit";
import { fmt } from "./format";
import { DAYS, NEXT_MONTH, OUT_AT, tracksFor } from "./series";

export function WorkflowsChart({
  out,
  frame,
  highlight = null,
}: {
  out: boolean;
  frame: Omit<Frame, "yMax">;
  highlight?: string | null;
}) {
  const [day, setDay] = useState<number | null>(null);
  const tracks = tracksFor(out);
  const top = Math.max(
    ...tracks.map((t) => Math.max(t.workflow.budget ?? 0, t.workflow.spentThisMonth)),
  );
  const f: Frame = { ...frame, yMax: niceMax(top) };
  const today = DAYS.length - 1;
  const faded = (id: string) => highlight !== null && highlight !== id && "opacity-15";
  const at = (i: number) => (i === today ? NOW : dayStart(i + 1));
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
        aria-label="Each workflow's spending this month as a running total, against its budget"
      >
        <Axes f={f} />
        <NowLine f={f} at={NOW} />
        {out ? (
          <g>
            <line
              x1={xOf(f, OUT_AT)}
              x2={xOf(f, OUT_AT)}
              y1={f.pad.top + 14}
              y2={yOf(f, 0)}
              className="stroke-destructive"
              strokeDasharray="4 3"
            />
            <text
              x={xOf(f, OUT_AT) - 6}
              y={f.pad.top + 24}
              textAnchor="end"
              className="fill-destructive text-[11px] font-medium"
            >
              Out of credits: all paused
            </text>
          </g>
        ) : null}
        {day === null ? null : (
          <line
            x1={xOf(f, at(day))}
            x2={xOf(f, at(day))}
            y1={f.pad.top}
            y2={yOf(f, 0)}
            className="stroke-foreground/30"
          />
        )}
        {tracks.map((t, n) => {
          const tone = WORKFLOW_TONES[n];
          const { budget, spentThisMonth: spent } = t.workflow;
          const pts = [{ at: DAYS[0], v: 0 }, ...t.cumulative.map((v, i) => ({ at: at(i), v }))];
          return (
            <g key={t.workflow.id} className={cn("transition-opacity", faded(t.workflow.id))}>
              {budget === null ? null : (
                <g>
                  <line
                    x1={xOf(f, DAYS[0])}
                    x2={xOf(f, NEXT_MONTH)}
                    y1={yOf(f, budget)}
                    y2={yOf(f, budget)}
                    className={tone.stroke}
                    strokeWidth={1.25}
                    strokeDasharray="5 4"
                  />
                  <text
                    x={xOf(f, NEXT_MONTH)}
                    y={yOf(f, budget) - 5}
                    textAnchor="end"
                    className="fill-muted-foreground text-[11px]"
                  >
                    Budget {fmt(budget)}
                  </text>
                </g>
              )}
              <polyline
                points={points(f, pts)}
                fill="none"
                className={tone.stroke}
                strokeWidth={2}
                strokeLinejoin="round"
              />
              {!out && t.pausedAt ? (
                <circle
                  cx={xOf(f, at(t.pausedAt < DAYS[today] ? today - 1 : today))}
                  cy={yOf(f, t.cumulative[t.pausedAt < DAYS[today] ? today - 1 : today])}
                  r={4}
                  className="fill-destructive stroke-background"
                  strokeWidth={2}
                />
              ) : null}
              <text
                x={xOf(f, NOW) + 8}
                y={yOf(f, spent) + 4}
                className="fill-foreground stroke-background text-[11px]"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {t.workflow.name}{" "}
                <tspan className="fill-muted-foreground tabular-nums">
                  {fmt(spent)}
                  {!out && t.paused ? ", paused" : ""}
                </tspan>
              </text>
            </g>
          );
        })}
        <DayHits f={f} days={DAYS.length} onDay={setDay} />
      </svg>
      {day === null ? null : (
        <Tooltip f={f} x={xOf(f, at(day))}>
          <p className="pb-1 font-medium">
            By the end of <DateTime value={dayStart(day)} day />
          </p>
          {tracks.map((t, n) => (
            <TipRow
              key={t.workflow.id}
              swatch={WORKFLOW_TONES[n].bg}
              label={t.workflow.name}
              value={t.cumulative[day]}
            />
          ))}
        </Tooltip>
      )}
    </div>
  );
}
