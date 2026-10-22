// PROTOTYPE, throwaway: variant C's ranking: workflows by what they spent a day over the last 7
// days, each with where that leaves its budget this month.
import Link from "next/link";
import { DateTime } from "@/components/date-time";
import { Badge } from "@/components/ui/badge";
import { NOW } from "../_shared/fixtures";
import { WORKFLOWS_BY_BURN, type WorkflowSpend } from "./fixtures";
import { fmt } from "./format";

const DAY_MS = 24 * 60 * 60 * 1000;
const NEXT_MONTH = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + 1, 1));

export function BurnList() {
  const top = WORKFLOWS_BY_BURN[0].perDay;
  const total = WORKFLOWS_BY_BURN.reduce((sum, w) => sum + w.burn7d, 0);
  return (
    <ol className="flex flex-col divide-y">
      {WORKFLOWS_BY_BURN.map((w, i) => (
        <li key={w.id} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 py-4">
          <span className="text-sm text-muted-foreground tabular-nums">{i + 1}</span>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <Link href="/prototype/workflow-status" className="font-medium hover:underline">
                {w.name}
              </Link>
              <span className="text-sm tabular-nums">
                {fmt(w.perDay)} a day{" "}
                <span className="text-muted-foreground">
                  ({String(Math.round((w.burn7d / total) * 100))}% of workflow spending)
                </span>
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-foreground"
                style={{ width: `${String((w.perDay / top) * 100)}%` }}
              />
            </div>
            <Outlook workflow={w} />
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Where the workflow's month is heading at its current rate. */
function Outlook({ workflow: w }: { workflow: WorkflowSpend }) {
  const text = "text-xs text-muted-foreground";
  if (w.paused === "failures") {
    return (
      <span className={`flex flex-wrap items-center gap-2 ${text}`}>
        <Badge variant="outline">Paused: failing</Badge> Not spending until an admin resumes it.
      </span>
    );
  }
  if (w.budget === null) {
    return <span className={text}>No budget: only the company&rsquo;s balance limits it.</span>;
  }
  if (w.spentThisMonth >= w.budget) {
    return (
      <span className={`flex flex-wrap items-center gap-2 ${text}`}>
        <Badge variant="destructive">Paused: budget reached</Badge>
        {fmt(w.spentThisMonth)} of {fmt(w.budget)}. Resumes <DateTime value={NEXT_MONTH} day />, or
        at once if you raise the budget.
      </span>
    );
  }
  const reachesAt = new Date(NOW.getTime() + ((w.budget - w.spentThisMonth) / w.perDay) * DAY_MS);
  if (reachesAt < NEXT_MONTH) {
    return (
      <span className="text-xs text-amber-700 dark:text-amber-400">
        {fmt(w.spentThisMonth)} of {fmt(w.budget)}. At this rate it reaches its budget around{" "}
        <DateTime value={reachesAt} day /> and pauses until the month ends.
      </span>
    );
  }
  return (
    <span className={text}>
      {fmt(w.spentThisMonth)} of {fmt(w.budget)}. Stays under its budget this month.
    </span>
  );
}
