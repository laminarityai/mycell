// PROTOTYPE, throwaway: variant C, "Runway forecast". The page answers "when do we run out?":
// a sentence and a chart of the balance heading to zero, then what is burning credits fastest.
// The month by kind of use and the ledger sit in a narrow side column.
import { DateTime } from "@/components/date-time";
import { CREDITS, LEDGER } from "../_shared/fixtures";
import { PrototypeHeader, PrototypeMain } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import { BurnList } from "./burn-list";
import { DAILY_USAGE, MONTH_GROUPS, MONTH_TOTAL, RUNS_OUT_AT } from "./fixtures";
import { ago, describe, fmt, signed } from "./format";
import { MemberNotice } from "./member-notice";
import { RunwayChart } from "./runway-chart";

export function VariantC({ params }: VariantProps) {
  if (params.as === "member") return <MemberNotice />;
  const earlier = DAILY_USAGE.slice(0, -7);
  const earlierRate = Math.round(earlier.reduce((a, b) => a + b, 0) / earlier.length);
  return (
    <PrototypeMain wide>
      <PrototypeHeader title="Credits" admin />
      <section aria-label="Runway" className="flex flex-col gap-4">
        <h2 className="max-w-3xl text-3xl leading-tight font-semibold tracking-tight text-balance">
          At this week&rsquo;s rate, credits run out around <DateTime value={RUNS_OUT_AT} day />.
        </h2>
        <p className="max-w-2xl text-muted-foreground">
          {fmt(CREDITS.balance)} credits left. The last 7 days used {fmt(CREDITS.dailyAverage7d)} a
          day, up from {fmt(earlierRate)} a day earlier in the month. When the balance reaches zero
          every workflow pauses until the Mycel team grants more; ask them before then.
        </p>
        <figure className="rounded-lg border p-4">
          <RunwayChart />
          <figcaption className="pt-2 text-xs text-muted-foreground">
            Solid: the balance at the end of each day (UTC). Dashed: the last 7 days&rsquo; average
            carried forward.
          </figcaption>
        </figure>
      </section>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-label="Workflows by burn" className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">What&rsquo;s spending fastest</h2>
          <p className="text-sm text-muted-foreground">
            Workflows by credits a day over the last 7 days, live runs only.
          </p>
          <BurnList />
        </section>

        <aside className="flex flex-col gap-8">
          <section aria-label="This month" className="flex flex-col gap-2 text-sm">
            <h2 className="font-semibold">This month, {fmt(MONTH_TOTAL)} credits</h2>
            <dl className="flex flex-col">
              {MONTH_GROUPS.map((g) => (
                <div key={g.key} className="flex justify-between border-b py-1.5">
                  <dt>{g.label}</dt>
                  <dd className="tabular-nums">{fmt(g.credits)}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section aria-label="Latest entries" className="flex flex-col gap-2 text-sm">
            <h2 className="font-semibold">Latest entries</h2>
            <ul className="flex flex-col">
              {LEDGER.map((entry) => {
                const { title, detail } = describe(entry);
                return (
                  <li key={entry.id} className="flex justify-between gap-3 border-b py-2">
                    <span className="flex min-w-0 flex-col">
                      <span className={entry.kind === "usage" ? "" : "font-medium"}>{title}</span>
                      <span className="truncate text-xs text-muted-foreground" title={detail}>
                        {ago(entry.at)}
                        {detail ? `, ${detail}` : ""}
                      </span>
                    </span>
                    <span
                      className={
                        entry.kind === "grant"
                          ? "font-semibold text-emerald-700 tabular-nums dark:text-emerald-400"
                          : "tabular-nums"
                      }
                    >
                      {signed(entry.credits)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </aside>
      </div>
    </PrototypeMain>
  );
}
