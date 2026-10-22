// PROTOTYPE, throwaway: variant B, "Breakdown first". Where the month went leads: one stacked bar
// by kind of use, then every workflow as a meter against its budget. The balance is a slim strip
// and the ledger waits in its own tab.
import { DateTime } from "@/components/date-time";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CREDITS } from "../_shared/fixtures";
import { PrototypeHeader, PrototypeMain } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import { BudgetMeter, MonthBar } from "./breakdown-parts";
import { MONTH_START, MONTH_TOTAL, RUNWAY_DAYS, RUNS_OUT_AT, WORKFLOWS_BY_SPEND } from "./fixtures";
import { fmt } from "./format";
import { LedgerTable } from "./ledger-table";
import { MemberNotice } from "./member-notice";

export function VariantB({ params }: VariantProps) {
  if (params.as === "member") return <MemberNotice />;
  const scale = Math.max(...WORKFLOWS_BY_SPEND.map((w) => w.budget ?? w.spentThisMonth));
  return (
    <PrototypeMain wide>
      <PrototypeHeader title="Credits" admin />
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 border-y py-3 text-sm">
        <span>
          <span className="text-muted-foreground">Balance </span>
          <span className="text-base font-semibold tabular-nums">{fmt(CREDITS.balance)}</span>
        </span>
        <span>
          <span className="text-muted-foreground">Lasts about </span>
          <span className="font-medium">{RUNWAY_DAYS} days</span>
          <span className="text-muted-foreground">
            {" "}
            (to <DateTime value={RUNS_OUT_AT} day />, at {fmt(CREDITS.dailyAverage7d)} a day)
          </span>
        </span>
        <span>
          <span className="text-muted-foreground">Spent since </span>
          <DateTime value={MONTH_START} day />{" "}
          <span className="font-medium tabular-nums">{fmt(MONTH_TOTAL)}</span>
        </span>
      </div>

      <Tabs defaultValue="month">
        <TabsList>
          <TabsTrigger value="month">This month</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
        </TabsList>
        <TabsContent value="month" className="flex flex-col gap-10 pt-4">
          <section aria-label="By kind of use" className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">
              {fmt(MONTH_TOTAL)} credits this month, by kind of use
            </h2>
            <MonthBar />
          </section>
          <section aria-label="Workflows against their budgets" className="flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">Workflows against their budgets</h2>
              <p className="text-xs text-muted-foreground">
                Live runs only. Budgets count the calendar month in UTC.
              </p>
            </div>
            <ul className="divide-y">
              {WORKFLOWS_BY_SPEND.map((w) => (
                <BudgetMeter key={w.id} workflow={w} scale={scale} />
              ))}
            </ul>
          </section>
        </TabsContent>
        <TabsContent value="ledger" className="flex flex-col gap-3 pt-4">
          <p className="text-sm text-muted-foreground">
            The latest entries, newest first. A correction records what a failed call really cost
            once the gateway has billed it.
          </p>
          <LedgerTable />
        </TabsContent>
      </Tabs>
    </PrototypeMain>
  );
}
