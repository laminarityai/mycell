// PROTOTYPE, throwaway: variant E, "One chart, many lenses". B's summary strip, then one large
// chart that plots the balance, spending by kind, or spending by workflow, with B's breakdown
// beneath it as the chart's key: point at a kind or a workflow to see its series. Ledger below.
import { DateTime } from "@/components/date-time";
import { SidebarShell } from "../_shared/sidebar-shell";
import type { VariantProps } from "../_shared/prototype-page";
import { fmt } from "./format";
import { LedgerTable } from "./ledger-table";
import { LensPanel } from "./lens-panel";
import { ShellMemberNotice } from "./member-notice";
import { creditScenario, MONTH_START } from "./series";

export function VariantE({ params }: VariantProps) {
  if (params.as === "member") return <ShellMemberNotice params={params} />;
  const out = params.credits === "out";
  const s = creditScenario(out);
  return (
    <SidebarShell params={params} current="credits" title="Credits" width="wide">
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 border-y py-3 text-sm">
        <span>
          <span className="text-muted-foreground">Balance </span>
          <span
            className={
              out
                ? "text-base font-semibold text-destructive tabular-nums"
                : "text-base font-semibold tabular-nums"
            }
          >
            {fmt(s.balance)}
          </span>
        </span>
        {out ? (
          <span className="text-destructive">
            Out of credits since <DateTime value={s.zeroAt} />: every workflow is paused until the
            Mycel team grants more
          </span>
        ) : (
          <span>
            <span className="text-muted-foreground">Lasts about </span>
            <span className="font-medium">{Math.floor(s.balance / s.rate)} days</span>
            <span className="text-muted-foreground">
              {" "}
              (to <DateTime value={s.zeroAt} day />, at {fmt(s.rate)} a day)
            </span>
          </span>
        )}
        <span>
          <span className="text-muted-foreground">Spent since </span>
          <DateTime value={MONTH_START} day />{" "}
          <span className="font-medium tabular-nums">{fmt(s.spent)}</span>
        </span>
      </div>

      <LensPanel out={out} />

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
