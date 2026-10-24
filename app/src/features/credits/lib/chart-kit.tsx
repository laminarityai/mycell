// What every chart on the Credits page shares: one time axis over the range's days (so the past
// and a projection sit on one ruler), recessive gridlines, a "Now" line, and the colours of each
// kind of use and each workflow.
import { formatCredits } from "../format";
import { includesNow } from "../range";
import { DAY_MS, monthRange, type SpendingKind, type SpendingSummary } from "../types";

export type Frame = {
  w: number;
  h: number;
  pad: { left: number; right: number; top: number; bottom: number };
  /** The range's first day, and how many days it has. */
  from: Date;
  days: number;
  yMax: number;
};

export const FRAME = {
  w: 980,
  h: 340,
  pad: { left: 56, right: 24, top: 24, bottom: 28 },
} as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 8", the UTC day. SVG text can't hold a <time>, so the axis spells it out. */
export const tick = (at: Date) => `${MONTHS[at.getUTCMonth()] ?? ""} ${String(at.getUTCDate())}`;

/** "Oct 1 – Oct 7, 2026", or "Oct 8, 2026" for one day: a stretch of days in a tooltip. */
export function stretch(from: Date, days: number): string {
  const last = new Date(from.getTime() + (days - 1) * DAY_MS);
  const year = String(last.getUTCFullYear());
  if (days <= 1) return `${tick(from)}, ${year}`;
  const sameYear = from.getUTCFullYear() === last.getUTCFullYear();
  return `${tick(from)}${sameYear ? "" : `, ${String(from.getUTCFullYear())}`} – ${tick(last)}, ${year}`;
}

/**
 * How many days the chart's time axis spans: the range's, running on to the end of this month
 * while the range includes today, so the days to come hold the balance's projection.
 */
export function axisDays(summary: SpendingSummary, now: Date): number {
  if (!includesNow(summary.range, now)) return summary.days.length;
  const monthEnd = monthRange(now).to.getTime();
  return Math.max(
    summary.days.length,
    Math.round((monthEnd - summary.range.from.getTime()) / DAY_MS),
  );
}

/**
 * Where the axis's dates go: every 7 days from the start over a short range, else on each 1st,
 * every other 1st past 7 months, with the year on the first and on January.
 */
function ticksOf(f: Frame): { day: number; label: string }[] {
  if (f.days <= 45) {
    return Array.from({ length: Math.ceil(f.days / 7) }, (_, i) => i * 7).map((day) => ({
      day: day + 0.5,
      label: tick(new Date(f.from.getTime() + day * DAY_MS)),
    }));
  }
  const firsts = Array.from({ length: f.days }, (_, day) => day).filter(
    (day) => new Date(f.from.getTime() + day * DAY_MS).getUTCDate() === 1,
  );
  const every = firsts.length > 7 ? 2 : 1;
  return firsts
    .filter((_, n) => n % every === 0)
    .map((day, n) => {
      const at = new Date(f.from.getTime() + day * DAY_MS);
      const month = MONTHS[at.getUTCMonth()] ?? "";
      return {
        day,
        label:
          n === 0 || at.getUTCMonth() === 0 ? `${month} ${String(at.getUTCFullYear())}` : month,
      };
    });
}

/** Days from the range's start to `at`, fractional. */
export const dayAt = (f: Frame, at: Date) => (at.getTime() - f.from.getTime()) / DAY_MS;

/** The x of a moment `day` days into the range (day 2.5 is noon on its third day). */
export const xOf = (f: Frame, day: number) =>
  f.pad.left + (day / f.days) * (f.w - f.pad.left - f.pad.right);

export const yOf = (f: Frame, v: number) =>
  f.pad.top + (1 - Math.max(0, v) / f.yMax) * (f.h - f.pad.top - f.pad.bottom);

/** One day's width. */
export const dayW = (f: Frame) => (f.w - f.pad.left - f.pad.right) / f.days;

const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10];

/**
 * A top for the y axis with a little room above `v`, split into the axis's 4 round steps:
 * 1,000 → 1,200 (by 300), 544 → 600 (by 150).
 */
export function niceMax(v: number): number {
  const raw = (Math.max(v, 1) * 1.08) / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = NICE_STEPS.map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  return step * 4;
}

/** A polyline's points from (day, value) pairs. */
export const points = (f: Frame, pts: [number, number][]) =>
  pts.map(([day, v]) => `${String(xOf(f, day))},${String(yOf(f, v))}`).join(" ");

/** Gridlines with their values, and dates along the bottom. */
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
            {formatCredits(v)}
          </text>
        </g>
      ))}
      <DateTicks f={f} />
    </g>
  );
}

/** The axis's dates along the bottom. */
export function DateTicks({ f }: { f: Frame }) {
  return (
    <g className="text-[11px]">
      {ticksOf(f).map(({ day, label }) => (
        <text
          key={day}
          x={xOf(f, day)}
          y={f.h - 8}
          textAnchor="middle"
          className="fill-muted-foreground"
        >
          {label}
        </text>
      ))}
    </g>
  );
}

/** A dotted line at now, when now is in the range. */
export function NowLine({ f, day }: { f: Frame; day: number }) {
  if (day < 0 || day > f.days) return null;
  return (
    <g>
      <line
        x1={xOf(f, day)}
        x2={xOf(f, day)}
        y1={f.pad.top}
        y2={yOf(f, 0)}
        className="stroke-muted-foreground"
        strokeDasharray="2 3"
      />
      <text
        x={xOf(f, day)}
        y={f.pad.top - 6}
        textAnchor="middle"
        className="fill-muted-foreground text-[11px]"
      >
        Now
      </text>
    </g>
  );
}

/** Each kind of use's colour, as a fill (charts) and a background (swatches). */
export const KIND_COLORS: Record<SpendingKind, { fill: string; bg: string }> = {
  workflow: { fill: "fill-[#2a78d6] dark:fill-[#3987e5]", bg: "bg-[#2a78d6] dark:bg-[#3987e5]" },
  memory: { fill: "fill-[#eb6834] dark:fill-[#d95926]", bg: "bg-[#eb6834] dark:bg-[#d95926]" },
  builder: { fill: "fill-[#1baf7a] dark:fill-[#199e70]", bg: "bg-[#1baf7a] dark:bg-[#199e70]" },
  try_it: { fill: "fill-[#e87ba4] dark:fill-[#d55181]", bg: "bg-[#e87ba4] dark:bg-[#d55181]" },
};

/**
 * Workflows all belong to the blue Workflows kind, so each takes a step of the blue ramp,
 * darkest for the biggest spender. Lines carry direct labels, so identity isn't colour alone.
 */
const WORKFLOW_TONES = [
  { stroke: "stroke-[#104281] dark:stroke-[#cde2fb]", bg: "bg-[#104281] dark:bg-[#cde2fb]" },
  { stroke: "stroke-[#256abf] dark:stroke-[#86b6ef]", bg: "bg-[#256abf] dark:bg-[#86b6ef]" },
  { stroke: "stroke-[#3987e5] dark:stroke-[#5598e7]", bg: "bg-[#3987e5] dark:bg-[#5598e7]" },
  { stroke: "stroke-[#6da7ec] dark:stroke-[#2a78d6]", bg: "bg-[#6da7ec] dark:bg-[#2a78d6]" },
  { stroke: "stroke-[#86b6ef] dark:stroke-[#1c5cab]", bg: "bg-[#86b6ef] dark:bg-[#1c5cab]" },
] as const;

/** The nth workflow's tone, cycling past the ramp's five. */
export const workflowTone = (n: number) =>
  WORKFLOW_TONES[n % WORKFLOW_TONES.length] ?? WORKFLOW_TONES[0];
