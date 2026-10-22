// PROTOTYPE, throwaway: variant E2's breakdown under the chart, for the chosen range: kinds of
// use, and workflows against their budgets. Inside one month a workflow shows its meter; across
// months, when it reached its budget. Pointing at a row shows its series in the chart.
import { cn } from "@/lib/utils";
import { WORKFLOW_TONES } from "./chart-kit";
import { GROUP_COLOR, MONTH_GROUPS } from "./fixtures";
import { fmt } from "./format";
import { budgetHits, budgetIn, CREATED, historyFor, WORKFLOW_HISTORY } from "./history";
import type { Focus, Lens } from "./lens-summary";
import { dayLabel, includesToday, oneMonth, type DayRange } from "./range";
import { indexAt } from "./range-kit";
import { monthStartOf, MONTH_TO_DATE, sumIn } from "./range-model";
import { KIND_ORDER, tracksFor } from "./series";
import { PauseBadge } from "./workflow-rows";

const LABEL = Object.fromEntries(MONTH_GROUPS.map((g) => [g.key, g.label]));
const ROW =
  "grid w-full items-center gap-x-3 rounded-md px-2 py-2 text-left text-sm hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none";

export function RangeSummary({
  out,
  r,
  focus,
  onFocus,
  onPick,
}: {
  out: boolean;
  r: DayRange;
  focus: Focus;
  onFocus: (focus: Focus) => void;
  onPick: (lens: Lens) => void;
}) {
  const h = historyFor(out);
  const totals = KIND_ORDER.map((k) => sumIn(h.kinds[k], r.first, r.last));
  const spent = totals.reduce((a, b) => a + b, 0);
  const top = Math.max(1, ...totals);
  const single = oneMonth(r);
  const events = (lens: Lens, key: string) => ({
    onMouseEnter: () => {
      onFocus({ lens, key });
    },
    onFocus: () => {
      onFocus({ lens, key });
    },
    onMouseLeave: () => {
      onFocus(null);
    },
    onBlur: () => {
      onFocus(null);
    },
    onClick: () => {
      onPick(lens);
    },
  });
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <section aria-label="By kind of use" className="flex flex-col gap-1">
        <h2 className="flex items-baseline justify-between px-2 pb-1 font-semibold">
          By kind of use
          <span className="text-sm font-normal text-muted-foreground tabular-nums">
            {fmt(spent)} in this range
          </span>
        </h2>
        {KIND_ORDER.map((k, n) => (
          <button
            key={k}
            type="button"
            {...events("kinds", k)}
            className={cn(
              ROW,
              "grid-cols-[0.625rem_8rem_minmax(0,1fr)_7rem]",
              focus?.key === k && "bg-muted/60",
            )}
          >
            <span className={cn("size-2.5 rounded-sm", GROUP_COLOR[k])} />
            <span>{LABEL[k]}</span>
            <span className="h-1.5 rounded-full bg-muted">
              <span
                className={cn("block h-full rounded-full", GROUP_COLOR[k])}
                style={{ width: `${String((totals[n] / top) * 100)}%` }}
              />
            </span>
            <span className="text-right tabular-nums">
              {fmt(totals[n])}{" "}
              <span className="text-muted-foreground">
                {spent === 0 ? "" : `${String(Math.round((totals[n] / spent) * 100))}%`}
              </span>
            </span>
          </button>
        ))}
      </section>
      <section aria-label="Workflows against their budgets" className="flex flex-col gap-1">
        <h2 className="flex items-baseline justify-between px-2 pb-1 font-semibold">
          Workflows against their budgets
          <span className="text-sm font-normal text-muted-foreground">
            {single ? "the month so far, against its budget" : "spent in this range"}
          </span>
        </h2>
        {tracksFor(out).map((t, n) => {
          const id = t.workflow.id;
          const created = indexAt(CREATED[id]);
          const inRange = sumIn(WORKFLOW_HISTORY[id], r.first, r.last);
          const budget = budgetIn(id, monthStartOf(r.last));
          const monthSoFar = MONTH_TO_DATE[id][r.last];
          const hits = budgetHits(id).filter(
            (b) => indexAt(b.at) >= r.first && indexAt(b.at) <= r.last,
          );
          const note =
            created > r.last
              ? `Not made yet (made ${dayLabel(CREATED[id], true)})`
              : hits.length > 0
                ? `Reached its budget ${hits.map((b) => dayLabel(b.at)).join(", ")}`
                : budget === null
                  ? "No budget"
                  : single
                    ? null
                    : "Stayed under its budget";
          const reached = budget !== null && monthSoFar >= budget;
          return (
            <button
              key={id}
              type="button"
              {...events("workflows", id)}
              className={cn(
                ROW,
                "grid-cols-[0.625rem_minmax(0,1fr)_6rem_7rem]",
                focus?.key === id && "bg-muted/60",
              )}
            >
              <span className={cn("size-2.5 rounded-full", WORKFLOW_TONES[n].bg)} />
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate">{t.workflow.name}</span>
                  {includesToday(r) ? <PauseBadge reason={t.paused} /> : null}
                </span>
                {note === null ? null : (
                  <span className="text-xs text-muted-foreground">{note}</span>
                )}
              </span>
              {single && budget !== null && created <= r.last ? (
                <span className="h-1.5 rounded-full bg-muted">
                  <span
                    className={cn(
                      "block h-full rounded-full",
                      reached
                        ? "bg-destructive"
                        : monthSoFar / budget >= 0.7
                          ? "bg-amber-500"
                          : "bg-foreground",
                    )}
                    style={{ width: `${String(Math.min(100, (monthSoFar / budget) * 100))}%` }}
                  />
                </span>
              ) : (
                <span />
              )}
              <span className="text-right tabular-nums">
                {fmt(single ? monthSoFar : inRange)}
                {single && budget !== null ? (
                  <span className="text-muted-foreground"> / {fmt(budget)}</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </section>
    </div>
  );
}
