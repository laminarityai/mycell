// PROTOTYPE, throwaway: variant D's workflow table. Each row is B's budget meter plus a small
// running total for the month against its budget line, dashed ahead at this week's rate (flat
// once paused, capped where the budget would pause it).
import Link from "next/link";
import { DateTime } from "@/components/date-time";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { NOW, type PausedReason } from "../_shared/fixtures";
import { points, xOf, yOf, type Frame } from "./chart-kit";
import { fmt } from "./format";
import { DAYS, NEXT_MONTH, type WorkflowTrack } from "./series";

const pct = (part: number, whole: number) => `${String(Math.min(100, (part / whole) * 100))}%`;

export function PauseBadge({ reason }: { reason: PausedReason | null }) {
  if (reason === "out_of_credits")
    return <Badge variant="destructive">Paused: out of credits</Badge>;
  if (reason === "budget_reached")
    return <Badge variant="destructive">Paused: budget reached</Badge>;
  if (reason === "failures") return <Badge variant="outline">Paused: failing</Badge>;
  return null;
}

/** Where the month is heading, in words. */
export function Outlook({ track: t }: { track: WorkflowTrack }) {
  const { budget, spentThisMonth: spent } = t.workflow;
  if (t.paused === "out_of_credits") {
    return <>Resumes by itself as soon as the Mycel team grants credits.</>;
  }
  if (t.paused === "failures") return <>Not spending until an admin resumes it.</>;
  if (t.paused === "budget_reached") {
    return (
      <>
        Resumes <DateTime value={NEXT_MONTH} day />, or at once if you raise the budget.
      </>
    );
  }
  if (budget === null) return <>No budget: only the company&rsquo;s balance limits it.</>;
  if (t.projected.length === 3) {
    return (
      <span className="text-amber-700 dark:text-amber-400">
        At this rate it reaches its budget around <DateTime value={t.projected[1].at} day /> and
        pauses until the month ends.
      </span>
    );
  }
  return <>{fmt(budget - spent)} left; stays under its budget this month.</>;
}

const SPARK: Omit<Frame, "yMax"> = { w: 200, h: 48, pad: { left: 2, right: 2, top: 6, bottom: 4 } };

export function SpendSparkline({ track: t }: { track: WorkflowTrack }) {
  const { budget } = t.workflow;
  const end = t.projected[t.projected.length - 1].spent;
  const f: Frame = { ...SPARK, yMax: Math.max(budget ?? 0, end) * 1.12 };
  const today = DAYS.length - 1;
  const actual = [
    { at: DAYS[0], v: 0 },
    ...t.cumulative.map((v, i) => ({
      at: i === today ? NOW : new Date(DAYS[i].getTime() + 86_400_000),
      v,
    })),
  ];
  const over = budget !== null && t.workflow.spentThisMonth >= budget;
  return (
    <svg
      viewBox={`0 0 ${String(f.w)} ${String(f.h)}`}
      className="h-12 w-full max-w-[200px]"
      role="img"
      aria-label={`${t.workflow.name}: running total this month${budget === null ? "" : ` against a budget of ${fmt(budget)}`}`}
    >
      <line x1={xOf(f, NOW)} x2={xOf(f, NOW)} y1={2} y2={f.h} className="stroke-border" />
      {budget === null ? null : (
        <line
          x1={f.pad.left}
          x2={f.w - f.pad.right}
          y1={yOf(f, budget)}
          y2={yOf(f, budget)}
          className="stroke-muted-foreground"
          strokeDasharray="3 3"
        />
      )}
      <polyline
        points={points(
          f,
          t.projected.map((p) => ({ at: p.at, v: p.spent })),
        )}
        fill="none"
        className="stroke-muted-foreground"
        strokeWidth={1.5}
        strokeDasharray="3 3"
      />
      <polyline
        points={points(f, actual)}
        fill="none"
        className={cn(over ? "stroke-destructive" : "stroke-[#2a78d6] dark:stroke-[#3987e5]")}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {t.pausedAt ? (
        <circle
          cx={xOf(f, NOW)}
          cy={yOf(f, t.workflow.spentThisMonth)}
          r={3.5}
          className="fill-destructive stroke-background"
          strokeWidth={1.5}
        />
      ) : null}
    </svg>
  );
}

export function WorkflowRow({ track: t, scale }: { track: WorkflowTrack; scale: number }) {
  const { budget, spentThisMonth: spent } = t.workflow;
  const reached = budget !== null && spent >= budget;
  const near = budget !== null && !reached && spent / budget >= 0.7;
  return (
    <li className="grid grid-cols-1 gap-3 py-4 md:grid-cols-[15rem_12rem_minmax(0,1fr)_8rem] md:items-center md:gap-6">
      <div className="flex flex-col items-start gap-1">
        <Link href="/prototype/workflow-status" className="font-medium hover:underline">
          {t.workflow.name}
        </Link>
        <PauseBadge reason={t.paused} />
      </div>
      <SpendSparkline track={t} />
      <div className="flex flex-col gap-1.5">
        <div className="h-2 rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full",
              budget === null
                ? "bg-foreground/40"
                : reached
                  ? "bg-destructive"
                  : near
                    ? "bg-amber-500"
                    : "bg-foreground",
            )}
            style={{ width: budget === null ? pct(spent, scale) : pct(spent, budget) }}
          />
        </div>
        <span className="text-xs text-muted-foreground">
          <Outlook track={t} />
        </span>
      </div>
      <span className="flex flex-col text-sm tabular-nums md:text-right">
        <span>
          {fmt(spent)}
          <span className="text-muted-foreground">
            {budget === null ? " spent" : ` of ${fmt(budget)}`}
          </span>
        </span>
        <span className="text-xs text-muted-foreground">
          {fmt(Math.round(t.last7 / 7))} a day this week
        </span>
      </span>
    </li>
  );
}
