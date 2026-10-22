// PROTOTYPE, throwaway: what every round-2 credits chart shares: one time axis (the whole of
// October, so a chart's past and its projection sit on the same ruler), recessive gridlines,
// the series colours, and a positioned tooltip.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { fmt } from "./format";
import { DAY_MS, MONTH_START, NEXT_MONTH, type KindKey } from "./series";

export type Frame = {
  w: number;
  h: number;
  pad: { left: number; right: number; top: number; bottom: number };
  yMax: number;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 8", in UTC like every date Mycel shows. SVG text can't hold a <time>. */
export const tick = (at: Date) => `${MONTHS[at.getUTCMonth()]} ${String(at.getUTCDate())}`;

const SPAN = NEXT_MONTH.getTime() - MONTH_START.getTime();
export const MONTH_DAYS = Math.round(SPAN / DAY_MS);

export const xOf = (f: Frame, at: Date) =>
  f.pad.left + ((at.getTime() - MONTH_START.getTime()) / SPAN) * (f.w - f.pad.left - f.pad.right);
export const yOf = (f: Frame, v: number) =>
  f.pad.top + (1 - v / f.yMax) * (f.h - f.pad.top - f.pad.bottom);
/** One day's width. */
export const dayW = (f: Frame) => (f.w - f.pad.left - f.pad.right) / MONTH_DAYS;
export const dayStart = (i: number) => new Date(MONTH_START.getTime() + i * DAY_MS);

/** A round top for the y axis: 544 → 600, 1,363 → 1,500. */
export function niceMax(v: number) {
  const step = 10 ** Math.floor(Math.log10(v)) / 2;
  return Math.ceil((v * 1.08) / step) * step;
}

export const points = (f: Frame, pts: { at: Date; v: number }[]) =>
  pts.map((p) => `${String(xOf(f, p.at))},${String(yOf(f, p.v))}`).join(" ");

/** Gridlines with their values, and Oct 1 / 8 / 15 / 22 / 29 along the bottom. */
export function Axes({ f, steps = 4 }: { f: Frame; steps?: number }) {
  const values = Array.from({ length: steps + 1 }, (_, i) => (f.yMax / steps) * i);
  return (
    <g className="text-[11px]">
      {values.map((v) => (
        <g key={v}>
          <line
            x1={f.pad.left}
            x2={f.w - f.pad.right}
            y1={yOf(f, v)}
            y2={yOf(f, v)}
            className={v === 0 ? "stroke-muted-foreground/50" : "stroke-border"}
          />
          <text
            x={f.pad.left - 8}
            y={yOf(f, v) + 4}
            textAnchor="end"
            className="fill-muted-foreground tabular-nums"
          >
            {fmt(v)}
          </text>
        </g>
      ))}
      {[0, 7, 14, 21, 28].map((d) => (
        <text
          key={d}
          x={xOf(f, dayStart(d)) + dayW(f) / 2}
          y={f.h - 8}
          textAnchor="middle"
          className="fill-muted-foreground"
        >
          {tick(dayStart(d))}
        </text>
      ))}
    </g>
  );
}

/** A dotted line at now. */
export function NowLine({ f, at, label = "Now" }: { f: Frame; at: Date; label?: string }) {
  return (
    <g>
      <line
        x1={xOf(f, at)}
        x2={xOf(f, at)}
        y1={f.pad.top}
        y2={yOf(f, 0)}
        className="stroke-muted-foreground"
        strokeDasharray="2 3"
      />
      <text
        x={xOf(f, at)}
        y={f.pad.top - 4}
        textAnchor="middle"
        className="fill-muted-foreground text-[11px]"
      >
        {label}
      </text>
    </g>
  );
}

/** Transparent day columns that report which day the pointer is over. */
export function DayHits({
  f,
  days,
  onDay,
}: {
  f: Frame;
  days: number;
  onDay: (i: number | null) => void;
}) {
  return (
    <g>
      {Array.from({ length: days }, (_, i) => (
        <rect
          key={i}
          x={xOf(f, dayStart(i))}
          y={f.pad.top}
          width={dayW(f)}
          height={f.h - f.pad.top - f.pad.bottom}
          className="fill-transparent"
          onMouseEnter={() => {
            onDay(i);
          }}
        />
      ))}
    </g>
  );
}

/** A small card beside the hovered day, flipped to the left in the chart's right half. */
export function Tooltip({ f, x, children }: { f: Frame; x: number; children: ReactNode }) {
  const pct = (x / f.w) * 100;
  return (
    <div
      className="pointer-events-none absolute top-3 z-10 min-w-40 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
      style={{
        left: `${String(pct)}%`,
        transform: pct > 55 ? "translateX(calc(-100% - 14px))" : "translateX(14px)",
      }}
    >
      {children}
    </div>
  );
}

/** One line of a tooltip: a swatch, a name, a number. */
export function TipRow({
  swatch,
  label,
  value,
  strong = false,
}: {
  swatch?: string;
  label: ReactNode;
  value: number;
  strong?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2 py-0.5", strong && "border-t pt-1 font-medium")}>
      {swatch ? <span className={cn("size-2 shrink-0 rounded-sm", swatch)} /> : null}
      <span className="flex-1 truncate">{label}</span>
      <span className="tabular-nums">{fmt(value)}</span>
    </div>
  );
}

/** Kinds of use, in round 1's colours (the dataviz reference palette, first six slots). */
export const KIND_FILL: Record<KindKey, string> = {
  workflows: "fill-[#2a78d6] dark:fill-[#3987e5]",
  memory: "fill-[#eb6834] dark:fill-[#d95926]",
  builder: "fill-[#1baf7a] dark:fill-[#199e70]",
  agent: "fill-[#eda100] dark:fill-[#c98500]",
  try_it: "fill-[#e87ba4] dark:fill-[#d55181]",
  injection_screen: "fill-[#008300] dark:fill-[#008300]",
};

/**
 * Workflows are all part of the blue Workflows kind, so each takes a step of the blue ramp,
 * darkest for the biggest spender. Lines carry direct labels, so identity isn't colour alone.
 */
export const WORKFLOW_TONES = [
  { stroke: "stroke-[#104281] dark:stroke-[#cde2fb]", bg: "bg-[#104281] dark:bg-[#cde2fb]" },
  { stroke: "stroke-[#256abf] dark:stroke-[#86b6ef]", bg: "bg-[#256abf] dark:bg-[#86b6ef]" },
  { stroke: "stroke-[#3987e5] dark:stroke-[#5598e7]", bg: "bg-[#3987e5] dark:bg-[#5598e7]" },
  { stroke: "stroke-[#6da7ec] dark:stroke-[#2a78d6]", bg: "bg-[#6da7ec] dark:bg-[#2a78d6]" },
  { stroke: "stroke-[#86b6ef] dark:stroke-[#1c5cab]", bg: "bg-[#86b6ef] dark:bg-[#1c5cab]" },
];
