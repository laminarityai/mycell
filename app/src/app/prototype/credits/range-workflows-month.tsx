"use client";

// PROTOTYPE, throwaway: variant E2's workflow lens for a range inside one month: E's running
// totals against budget lines, for whichever month it is. A past month shows where a workflow
// reached its budget and that it resumed on the 1st; one not made yet is named under the chart.
import { useState } from "react";
import { cn } from "@/lib/utils";
import { NOW } from "../_shared/fixtures";
import { TipRow, Tooltip, WORKFLOW_TONES } from "./chart-kit";
import { fmt } from "./format";
import { budgetHits, budgetIn, CREATED, HISTORY_DAYS } from "./history";
import { dayLabel, TODAY_INDEX, type DayRange } from "./range";
import {
  BucketHits,
  dayBuckets,
  indexAt,
  line,
  niceTop,
  RangeAxes,
  xAt,
  yAt,
  type RangeFrame,
} from "./range-kit";
import { domainEnd, monthStartOf, MONTH_TO_DATE } from "./range-model";
import { OUT_AT, tracksFor } from "./series";

export function RangeWorkflowsMonth({
  out,
  r,
  frame,
  highlight = null,
}: {
  out: boolean;
  r: DayRange;
  frame: Omit<RangeFrame, "yMax" | "first" | "end">;
  highlight?: string | null;
}) {
  const [hit, setHit] = useState<number | null>(null);
  const month = monthStartOf(r.first);
  const now = indexAt(NOW);
  const rows = tracksFor(out).map((t, n) => {
    const id = t.workflow.id;
    const created = indexAt(CREATED[id]);
    const from = Math.max(r.first, created);
    const mtd = MONTH_TO_DATE[id];
    const pts: [number, number][] = [];
    if (from <= r.last) {
      pts.push([
        from,
        from === created || HISTORY_DAYS[from].getUTCDate() === 1 ? 0 : mtd[from - 1],
      ]);
      for (let i = from; i <= r.last; i++) pts.push([i === TODAY_INDEX ? now : i + 1, mtd[i]]);
    }
    const reached = budgetHits(id).find(
      (b) => monthStartOf(indexAt(b.at)).getTime() === month.getTime(),
    );
    return { t, n, id, pts, budget: budgetIn(id, month), reached, created, end: mtd[r.last] };
  });
  const shown = rows.filter((row) => row.pts.length > 0);
  const missing = rows.filter((row) => row.pts.length === 0);
  const top = Math.max(1, ...shown.map((row) => Math.max(row.budget ?? 0, row.end)));
  const f: RangeFrame = {
    ...frame,
    first: r.first,
    end: domainEnd(r, out),
    yMax: niceTop(top * 1.08),
  };
  const roomRight = f.end - r.last > (f.end - f.first) * 0.25;
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
        aria-label="Each workflow's running total for the month, against its budget"
      >
        <RangeAxes f={f} r={r} />
        {out && r.last === TODAY_INDEX ? (
          <g>
            <line
              x1={xAt(f, indexAt(OUT_AT))}
              x2={xAt(f, indexAt(OUT_AT))}
              y1={f.pad.top + 14}
              y2={yAt(f, 0)}
              className="stroke-destructive"
              strokeDasharray="4 3"
            />
            <text
              x={xAt(f, indexAt(OUT_AT)) - 6}
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
            x1={xAt(f, day + 1)}
            x2={xAt(f, day + 1)}
            y1={f.pad.top}
            y2={yAt(f, 0)}
            className="stroke-foreground/30"
          />
        )}
        {shown.map((row) => {
          const tone = WORKFLOW_TONES[row.n];
          const [lx, lv] = row.pts[row.pts.length - 1];
          const reachedHere =
            row.reached && indexAt(row.reached.at) >= r.first && indexAt(row.reached.at) <= r.last;
          const resumed = row.reached && indexAt(row.reached.resumes) <= TODAY_INDEX;
          return (
            <g
              key={row.id}
              className={cn(
                "transition-opacity",
                highlight !== null && highlight !== row.id && "opacity-15",
              )}
            >
              {row.budget === null ? null : (
                <g>
                  <line
                    x1={xAt(f, r.first)}
                    x2={xAt(f, f.end)}
                    y1={yAt(f, row.budget)}
                    y2={yAt(f, row.budget)}
                    className={tone.stroke}
                    strokeWidth={1.25}
                    strokeDasharray="5 4"
                  />
                  <text
                    x={xAt(f, f.end)}
                    y={yAt(f, row.budget) - 5}
                    textAnchor="end"
                    className="fill-muted-foreground text-[11px]"
                  >
                    Budget {fmt(row.budget)}
                  </text>
                </g>
              )}
              <polyline
                points={line(f, row.pts)}
                fill="none"
                className={tone.stroke}
                strokeWidth={2}
                strokeLinejoin="round"
              />
              {reachedHere && row.reached ? (
                <circle
                  cx={xAt(f, indexAt(row.reached.at) + 1)}
                  cy={yAt(f, row.budget ?? 0)}
                  r={4}
                  className="fill-destructive stroke-background"
                  strokeWidth={2}
                />
              ) : null}
              <text
                x={roomRight ? xAt(f, lx) + 8 : xAt(f, lx) - 4}
                y={roomRight ? yAt(f, lv) + 4 : yAt(f, lv) - 6}
                textAnchor={roomRight ? "start" : "end"}
                className="fill-foreground stroke-background text-[11px]"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {row.t.workflow.name}{" "}
                <tspan className="fill-muted-foreground tabular-nums">
                  {fmt(lv)}
                  {reachedHere && row.reached
                    ? `, reached its budget ${dayLabel(row.reached.at)}${resumed ? `, resumed ${dayLabel(row.reached.resumes)}` : ""}`
                    : !out && r.last === TODAY_INDEX && row.t.paused
                      ? ", paused"
                      : ""}
                </tspan>
              </text>
            </g>
          );
        })}
        <BucketHits f={f} buckets={dayBuckets(r)} onHit={setHit} />
      </svg>
      {day === null ? null : (
        <Tooltip f={f} x={xAt(f, day + 1)}>
          <p className="pb-1 font-medium">
            This month by the end of {dayLabel(HISTORY_DAYS[day], true)}
          </p>
          {shown
            .filter((row) => row.created <= day)
            .map((row) => (
              <TipRow
                key={row.id}
                swatch={WORKFLOW_TONES[row.n].bg}
                label={row.t.workflow.name}
                value={MONTH_TO_DATE[row.id][day]}
              />
            ))}
        </Tooltip>
      )}
      {missing.length > 0 ? (
        <p className="pt-2 text-xs text-muted-foreground">
          Not made yet:{" "}
          {missing
            .map((row) => `${row.t.workflow.name} (made ${dayLabel(CREATED[row.id], true)})`)
            .join("; ")}
          .
        </p>
      ) : null}
    </div>
  );
}
