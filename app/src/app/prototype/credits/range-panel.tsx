"use client";

// PROTOTYPE, throwaway: variant E2's page body under the title. The range from the URL drives
// the strip's spending, the chart (all three lenses), the breakdown and the ledger; the balance
// and runway are always now, and say so.
import { useState } from "react";
import { DateTime } from "@/components/date-time";
import { cn } from "@/lib/utils";
import { LEDGER, type LedgerEntry } from "../_shared/fixtures";
import { fmt } from "./format";
import { GRANTS, grantNote, historyFor, HISTORY_DAYS, MONTH_STARTS } from "./history";
import { LedgerTable } from "./ledger-table";
import type { Focus, Lens } from "./lens-summary";
import { oneMonth, rangeWords, type DayRange } from "./range";
import { RangeBalanceChart } from "./range-balance-chart";
import { RangeKindsChart } from "./range-kinds-chart";
import { sumIn } from "./range-model";
import { RangeSummary } from "./range-summary";
import { RangeWorkflowsMonth } from "./range-workflows-month";
import { RangeWorkflowsMonths } from "./range-workflows-months";
import { creditScenario, DAY_MS, type KindKey } from "./series";
import { useRange } from "./use-range";

const FRAME = { w: 980, h: 360, pad: { left: 52, right: 20, top: 24, bottom: 28 } };

const LENSES: { key: Lens; label: string }[] = [
  { key: "balance", label: "Balance" },
  { key: "kinds", label: "Spending by kind" },
  { key: "workflows", label: "Spending by workflow" },
];

function lensText(lens: Lens, r: DayRange, out: boolean) {
  const span = r.last - r.first + 1;
  const unit = span <= 45 ? "day" : span <= 125 ? "week" : "month";
  if (lens === "balance") {
    return {
      title: "Balance",
      note: `Each month's allowance is a step up on the 1st.${out ? "" : " Dashed: this week's rate carried forward to zero."}`,
    };
  }
  if (lens === "kinds") {
    return {
      title: `Spent each ${unit}, by kind of use`,
      note: "Stacked in the order of the list below. A band that thickens is a kind that grew.",
    };
  }
  return oneMonth(r)
    ? {
        title: "Each workflow's running total for the month, against its budget",
        note: "Live runs only. Dashed: the monthly budget. A red dot: it reached it and paused.",
      }
    : {
        title: "Each workflow, month by month, against its budget",
        note: "Budgets are monthly, so each line starts again on the 1st under that month's budget (dashed). A red dot: it reached it and rested until the 1st. Each row has its own scale.",
      };
}

function entriesIn(r: DayRange): LedgerEntry[] {
  const from = HISTORY_DAYS[r.first].getTime();
  const to = HISTORY_DAYS[r.last].getTime() + DAY_MS;
  const grants = MONTH_STARTS.map((at, m): LedgerEntry => ({
    id: `g-${String(m)}`,
    at,
    kind: "grant",
    credits: GRANTS[m],
    note: grantNote(m),
  }));
  return [...LEDGER.filter((e) => e.kind !== "grant"), ...grants]
    .filter((e) => e.at.getTime() >= from && e.at.getTime() < to)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

export function RangePanel({ out }: { out: boolean }) {
  const { range: r } = useRange();
  const [lens, setLens] = useState<Lens>("balance");
  const [focus, setFocus] = useState<Focus>(null);
  const s = creditScenario(out);
  const h = historyFor(out);
  const shown = focus?.lens ?? lens;
  const text = lensText(shown, r, out);
  const entries = entriesIn(r);
  const usage = entries.filter((e) => e.kind !== "grant").length;
  const spent = sumIn(h.daily, r.first, r.last);
  const granted = sumIn(h.granted, r.first, r.last);
  const kindFocus = focus?.lens === "kinds" ? (focus.key as KindKey) : null;
  const wfFocus = focus?.lens === "workflows" ? focus.key : null;
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 border-y py-3 text-sm">
        <span>
          <span className="text-muted-foreground">Balance now </span>
          <span className={cn("text-base font-semibold tabular-nums", out && "text-destructive")}>
            {fmt(s.balance)}
          </span>
        </span>
        {out ? (
          <span className="text-destructive">
            Out of credits since <DateTime value={s.zeroAt} />: every workflow is paused
          </span>
        ) : (
          <span>
            <span className="text-muted-foreground">From today, lasts about </span>
            <span className="font-medium">{Math.floor(s.balance / s.rate)} days</span>
            <span className="text-muted-foreground">
              {" "}
              (to <DateTime value={s.zeroAt} day />, at {fmt(s.rate)} a day)
            </span>
          </span>
        )}
        <span className="flex flex-wrap gap-x-6 gap-y-1 sm:ml-auto">
          <span>
            <span className="text-muted-foreground">Spent {rangeWords(r)} </span>
            <span className="font-medium tabular-nums">{fmt(spent)}</span>
          </span>
          <span>
            <span className="text-muted-foreground">Granted </span>
            <span className="font-medium tabular-nums">{fmt(granted)}</span>
          </span>
        </span>
      </div>

      <section aria-label="Over time" className="flex flex-col gap-4 rounded-lg border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex max-w-2xl flex-col gap-0.5">
            <h2 className="font-semibold">{text.title}</h2>
            <p className="text-xs text-muted-foreground">{text.note}</p>
          </div>
          <div
            role="group"
            aria-label="Plot"
            className="inline-flex rounded-lg bg-muted p-[3px] text-sm"
          >
            {LENSES.map((l) => (
              <button
                key={l.key}
                type="button"
                aria-pressed={lens === l.key}
                onClick={() => {
                  setLens(l.key);
                }}
                className={cn(
                  "rounded-md px-3 py-1 text-muted-foreground hover:text-foreground",
                  lens === l.key && "bg-background font-medium text-foreground shadow-xs",
                  shown === l.key && lens !== l.key && "text-foreground ring-1 ring-border",
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
        {shown === "balance" ? (
          <RangeBalanceChart out={out} r={r} frame={FRAME} />
        ) : shown === "kinds" ? (
          <RangeKindsChart out={out} r={r} frame={FRAME} highlight={kindFocus} />
        ) : oneMonth(r) ? (
          <RangeWorkflowsMonth out={out} r={r} frame={FRAME} highlight={wfFocus} />
        ) : (
          <RangeWorkflowsMonths out={out} r={r} frame={FRAME} highlight={wfFocus} />
        )}
      </section>

      <div className="flex flex-col gap-2">
        <RangeSummary out={out} r={r} focus={focus} onFocus={setFocus} onPick={setLens} />
        <p className="px-2 text-xs text-muted-foreground">
          Point at a kind or a workflow to see it in the chart; click it to keep that view.
        </p>
      </div>

      <section aria-label="Entries in this range" className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Entries, {rangeWords(r)}</h2>
        <p className="text-sm text-muted-foreground">
          Newest first: grants, and the latest usage. A correction records what a failed call really
          cost once the gateway has billed it.
        </p>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No grants in this range.</p>
        ) : (
          <LedgerTable entries={entries} />
        )}
        {spent > 0 ? (
          <p className="text-xs text-muted-foreground">
            About {fmt(Math.max(0, Math.round(spent / 9) - usage))} more usage entries in this
            range.{" "}
            <button type="button" className="underline">
              Show them
            </button>
          </p>
        ) : null}
      </section>
    </div>
  );
}
