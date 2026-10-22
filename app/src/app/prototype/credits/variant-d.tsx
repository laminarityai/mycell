// PROTOTYPE, throwaway: variant D, "Breakdown over time". B's breakdown with time added: the
// balance and runway on top, then the balance through the month beside what each day cost by
// kind of use, then every workflow with its month as a running total against its budget. The
// ledger follows.
import { DateTime } from "@/components/date-time";
import { SidebarShell } from "../_shared/sidebar-shell";
import type { VariantProps } from "../_shared/prototype-page";
import { BalanceChart } from "./balance-chart";
import type { Frame } from "./chart-kit";
import { fmt } from "./format";
import { KindLegend } from "./kind-legend";
import { KindsChart } from "./kinds-chart";
import { LedgerTable } from "./ledger-table";
import { ShellMemberNotice } from "./member-notice";
import { creditScenario, GRANTED, MONTH_START, tracksFor } from "./series";
import { WorkflowRow } from "./workflow-rows";

const HALF: Omit<Frame, "yMax"> = {
  w: 560,
  h: 270,
  pad: { left: 48, right: 16, top: 22, bottom: 26 },
};

export function VariantD({ params }: VariantProps) {
  if (params.as === "member") return <ShellMemberNotice params={params} />;
  const out = params.credits === "out";
  const s = creditScenario(out);
  const tracks = tracksFor(out);
  const scale = Math.max(...tracks.map((t) => t.workflow.budget ?? t.workflow.spentThisMonth));
  const before = Math.round(s.daily.slice(0, -7).reduce((a, b) => a + b, 0) / (s.daily.length - 7));
  return (
    <SidebarShell params={params} current="credits" title="Credits" width="wide">
      <section
        aria-label="Balance"
        className="grid gap-6 border-y py-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-end sm:gap-10"
      >
        <p className="flex flex-col">
          <span className="text-sm text-muted-foreground">Balance</span>
          <span
            className={
              out
                ? "text-4xl font-semibold tracking-tight text-destructive"
                : "text-4xl font-semibold tracking-tight"
            }
          >
            {fmt(s.balance)}
            <span className="pl-2 text-base font-normal text-muted-foreground">credits</span>
          </span>
        </p>
        {out ? (
          <p className="max-w-prose text-sm">
            <span className="font-medium text-destructive">
              Out of credits since <DateTime value={s.zeroAt} />.
            </span>{" "}
            Every workflow is paused and no runs start. They resume by themselves once the Mycel
            team grants more. Memory used {fmt(s.kinds.memory.slice(-4).reduce((a, b) => a + b, 0))}{" "}
            credits in the last 4 days.
          </p>
        ) : (
          <p className="max-w-prose text-sm">
            Lasts about <span className="font-medium">{Math.floor(s.balance / s.rate)} days</span>,
            to around <DateTime value={s.zeroAt} day />, at this week&rsquo;s {fmt(s.rate)} a day.{" "}
            <span className="text-muted-foreground">
              Earlier this month it was {fmt(before)} a day.
            </span>
          </p>
        )}
        <p className="flex flex-col text-sm sm:text-right">
          <span className="text-muted-foreground">
            Spent since <DateTime value={MONTH_START} day />
          </span>
          <span className="tabular-nums">
            <span className="text-base font-semibold">{fmt(s.spent)}</span>
            <span className="text-muted-foreground"> of {fmt(GRANTED)} granted</span>
          </span>
        </p>
      </section>

      <div className="grid gap-8 xl:grid-cols-2">
        <figure className="flex flex-col gap-3">
          <figcaption className="flex flex-col gap-0.5">
            <span className="font-semibold">Balance this month</span>
            <span className="text-xs text-muted-foreground">
              {out
                ? "At the end of each day (UTC), until it reached zero."
                : "Solid: at the end of each day (UTC). Dashed: this week's rate carried forward."}
            </span>
          </figcaption>
          <BalanceChart out={out} frame={HALF} />
        </figure>
        <figure className="flex flex-col gap-3">
          <figcaption className="flex flex-col gap-0.5">
            <span className="font-semibold">Spent each day, by kind of use</span>
            <span className="text-xs text-muted-foreground">
              {fmt(s.spent)} credits this month. A band that thickens is a kind that grew.
            </span>
          </figcaption>
          <KindsChart out={out} frame={HALF} />
          <KindLegend out={out} />
        </figure>
      </div>

      <section aria-label="Workflows against their budgets" className="flex flex-col">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-2">
          <h2 className="text-lg font-semibold">Workflows against their budgets</h2>
          <p className="text-xs text-muted-foreground">
            Live runs only. Budgets count the calendar month in UTC. Dashed: this week&rsquo;s rate
            to the month&rsquo;s end.
          </p>
        </div>
        <div className="hidden grid-cols-[15rem_12rem_minmax(0,1fr)_8rem] gap-6 border-b py-2 text-xs text-muted-foreground md:grid">
          <span>Workflow</span>
          <span>Running total, Oct 1 to 31</span>
          <span>Against its budget</span>
          <span className="text-right">This month</span>
        </div>
        <ul className="divide-y">
          {tracks.map((t) => (
            <WorkflowRow key={t.workflow.id} track={t} scale={scale} />
          ))}
        </ul>
      </section>

      <section aria-label="Latest entries" className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Latest entries</h2>
        <p className="text-sm text-muted-foreground">
          Newest first. A correction records what a failed call really cost once the gateway has
          billed it.
        </p>
        <LedgerTable />
      </section>
    </SidebarShell>
  );
}
