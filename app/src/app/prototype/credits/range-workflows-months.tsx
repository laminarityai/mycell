"use client";

// PROTOTYPE, throwaway: variant E2's workflow lens across months, as one row per workflow.
// Budgets are monthly, so each row draws its running total for the month, starting again on
// each 1st, under that month's budget as a dashed step. Where it reached the budget is a red
// dot (it rested until the 1st); before a workflow was made, its row says so. Each row has its
// own scale, so the eye compares a workflow with its budget, not workflows with each other.
import { useState } from "react";
import { cn } from "@/lib/utils";
import { NOW } from "../_shared/fixtures";
import { TipRow, Tooltip, WORKFLOW_TONES } from "./chart-kit";
import { fmt } from "./format";
import {
  budgetHits,
  budgetIn,
  CREATED,
  HISTORY_DAYS,
  MONTH_STARTS,
  WORKFLOW_HISTORY,
} from "./history";
import { dayLabel, TODAY_INDEX, type DayRange } from "./range";
import { BucketHits, dayBuckets, indexAt, xAt, XTicks, type RangeFrame } from "./range-kit";
import { domainEnd, monthStartOf, MONTH_TO_DATE, sumIn } from "./range-model";
import { tracksFor } from "./series";

const ROW = 74;
const TITLE = 18;

export function RangeWorkflowsMonths({
  out,
  r,
  frame,
  highlight = null,
}: {
  out: boolean;
  r: DayRange;
  frame: Omit<RangeFrame, "yMax" | "first" | "end" | "h">;
  highlight?: string | null;
}) {
  const [hit, setHit] = useState<number | null>(null);
  const tracks = tracksFor(out);
  const h = frame.pad.top + tracks.length * ROW + frame.pad.bottom;
  const f: RangeFrame = { ...frame, h, first: r.first, end: domainEnd(r, out), yMax: 1 };
  const now = indexAt(NOW);
  const months = MONTH_STARTS.map((start, m) => {
    const next = MONTH_STARTS[m + 1] as Date | undefined;
    return { start, first: indexAt(start), last: next ? indexAt(next) - 1 : TODAY_INDEX };
  }).filter((m) => m.last >= r.first && m.first <= r.last);
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
        className="w-full overflow-visible"
        role="img"
        aria-label="Each workflow's running total for each month, against that month's budget"
      >
        {months.map((m) => (
          <line
            key={m.first}
            x1={xAt(f, Math.max(m.first, r.first))}
            x2={xAt(f, Math.max(m.first, r.first))}
            y1={f.pad.top}
            y2={h - f.pad.bottom}
            className="stroke-border"
          />
        ))}
        {day === null ? null : (
          <line
            x1={xAt(f, day + 1)}
            x2={xAt(f, day + 1)}
            y1={f.pad.top}
            y2={h - f.pad.bottom}
            className="stroke-foreground/30"
          />
        )}
        {tracks.map((t, n) => {
          const id = t.workflow.id;
          const tone = WORKFLOW_TONES[n];
          const created = indexAt(CREATED[id]);
          const mtd = MONTH_TO_DATE[id];
          const segments = months.map((m) => {
            const a = Math.max(m.first, r.first, created);
            const b = Math.min(m.last, r.last);
            return { ...m, a, b, budget: a <= b ? budgetIn(id, m.start) : null };
          });
          const peak = Math.max(
            1,
            ...segments.map((s) =>
              Math.max(s.budget ?? 0, s.a <= s.b ? Math.max(...mtd.slice(s.a, s.b + 1)) : 0),
            ),
          );
          const top = f.pad.top + n * ROW + TITLE;
          const base = f.pad.top + (n + 1) * ROW - 8;
          const y = (v: number) => base - (v / (peak * 1.1)) * (base - top);
          const hits = budgetHits(id).filter(
            (b) => indexAt(b.at) >= r.first && indexAt(b.at) <= r.last,
          );
          return (
            <g
              key={id}
              className={cn(
                "transition-opacity",
                highlight !== null && highlight !== id && "opacity-20",
              )}
            >
              <text x={f.pad.left} y={top - 6} className="fill-foreground text-[12px] font-medium">
                {t.workflow.name}
                <tspan className="fill-muted-foreground font-normal tabular-nums">
                  {"  "}
                  {fmt(sumIn(WORKFLOW_HISTORY[id], r.first, r.last))} in this range
                  {hits.length > 0
                    ? `, reached its budget ${hits.map((b) => dayLabel(b.at)).join(", ")}`
                    : ""}
                </tspan>
              </text>
              <line
                x1={f.pad.left}
                x2={f.w - f.pad.right}
                y1={base}
                y2={base}
                className="stroke-muted-foreground/40"
              />
              {created > r.first ? (
                <g>
                  <rect
                    x={xAt(f, r.first)}
                    y={top}
                    width={Math.max(0, xAt(f, Math.min(created, f.end)) - xAt(f, r.first))}
                    height={base - top}
                    className="fill-muted/60"
                  />
                  {xAt(f, Math.min(created, f.end)) - xAt(f, r.first) > 70 ? (
                    <text
                      x={(xAt(f, r.first) + xAt(f, Math.min(created, f.end))) / 2}
                      y={(top + base) / 2 + 4}
                      textAnchor="middle"
                      className="fill-muted-foreground text-[11px]"
                    >
                      {created > r.last
                        ? `Made ${dayLabel(CREATED[id], true)}, after this range`
                        : `Not made until ${dayLabel(CREATED[id])}`}
                    </text>
                  ) : null}
                </g>
              ) : null}
              {segments.map((s) =>
                s.a > s.b ? null : (
                  <g key={s.first}>
                    {s.budget === null ? null : (
                      <line
                        x1={xAt(f, s.a)}
                        x2={xAt(f, s.b + 1)}
                        y1={y(s.budget)}
                        y2={y(s.budget)}
                        className={tone.stroke}
                        strokeWidth={1.25}
                        strokeDasharray="4 3"
                      />
                    )}
                    <polyline
                      points={[
                        `${String(xAt(f, s.a))},${String(y(s.a === s.first || s.a === created ? 0 : mtd[s.a - 1]))}`,
                        ...Array.from({ length: s.b - s.a + 1 }, (_, k) => s.a + k).map(
                          (i) =>
                            `${String(xAt(f, i === TODAY_INDEX ? now : i + 1))},${String(y(mtd[i]))}`,
                        ),
                      ].join(" ")}
                      fill="none"
                      className={tone.stroke}
                      strokeWidth={1.75}
                      strokeLinejoin="round"
                    />
                  </g>
                ),
              )}
              {hits.map((b) => (
                <circle
                  key={b.at.getTime()}
                  cx={xAt(f, indexAt(b.at) + 1)}
                  cy={y(b.budget)}
                  r={3.5}
                  className="fill-destructive stroke-background"
                  strokeWidth={1.5}
                />
              ))}
              {segments.some((s) => s.budget !== null) ? (
                <text
                  x={f.w - f.pad.right}
                  y={top - 6}
                  textAnchor="end"
                  className="fill-muted-foreground text-[11px] tabular-nums"
                >
                  Budget{" "}
                  {[...new Set(segments.map((s) => s.budget).filter((v) => v !== null))]
                    .map(fmt)
                    .join(", then ")}{" "}
                  a month
                </text>
              ) : null}
            </g>
          );
        })}
        <XTicks f={f} r={r} />
        <BucketHits f={f} buckets={dayBuckets(r)} onHit={setHit} />
      </svg>
      {day === null ? null : (
        <Tooltip f={f} x={xAt(f, day + 1)}>
          <p className="pb-1 font-medium">{dayLabel(HISTORY_DAYS[day], true)}: month so far</p>
          {tracks
            .filter((t) => indexAt(CREATED[t.workflow.id]) <= day)
            .map((t) => {
              const budget = budgetIn(t.workflow.id, monthStartOf(day));
              return (
                <TipRow
                  key={t.workflow.id}
                  swatch={WORKFLOW_TONES[tracks.indexOf(t)].bg}
                  label={
                    budget === null ? t.workflow.name : `${t.workflow.name} (of ${fmt(budget)})`
                  }
                  value={MONTH_TO_DATE[t.workflow.id][day]}
                />
              );
            })}
        </Tooltip>
      )}
    </div>
  );
}
