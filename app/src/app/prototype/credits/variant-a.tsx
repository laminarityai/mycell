// PROTOTYPE, throwaway: variant A, "Bank statement". The balance heads the page like a statement
// does, the ledger comes straight after it, and where the month went closes the page as the
// statement's summary.
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { DateTime } from "@/components/date-time";
import { CREDITS, LEDGER, NOW, ORG } from "../_shared/fixtures";
import { PrototypeHeader, PrototypeMain } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import {
  HIDDEN_ENTRIES,
  MONTH_GROUPS,
  MONTH_START,
  MONTH_TOTAL,
  RUNWAY_DAYS,
  RUNS_OUT_AT,
  STATEMENT,
  WORKFLOWS_BY_SPEND,
} from "./fixtures";
import { budgetLine, fmt, signed } from "./format";
import { MemberNotice } from "./member-notice";
import { StatementTable } from "./statement-table";

export function VariantA({ params }: VariantProps) {
  if (params.as === "member") return <MemberNotice />;
  const granted = LEDGER.filter((e) => e.kind === "grant" && e.at >= MONTH_START).reduce(
    (sum, e) => sum + e.credits,
    0,
  );
  return (
    <PrototypeMain>
      <PrototypeHeader title="Credits" admin />
      <section aria-label="Balance" className="flex flex-col gap-5 rounded-lg border p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-muted-foreground">
          <span>{ORG.name}</span>
          <span>
            Balance at <DateTime value={NOW} />
          </span>
        </div>
        <p className="flex items-baseline gap-3">
          <span className="text-5xl font-semibold tracking-tight tabular-nums">
            {fmt(CREDITS.balance)}
          </span>
          <span className="text-lg text-muted-foreground">credits</span>
        </p>
        <p className="max-w-prose text-sm">
          At the last 7 days&rsquo; rate of {fmt(CREDITS.dailyAverage7d)} a day, that lasts about{" "}
          <strong>{RUNWAY_DAYS} days</strong>, until around <DateTime value={RUNS_OUT_AT} day />.
          When it reaches zero every workflow pauses until the Mycel team grants more.
        </p>
        <dl className="grid grid-cols-3 gap-4 border-t pt-4 text-sm">
          <div>
            <dt className="text-muted-foreground">Granted this month</dt>
            <dd className="tabular-nums">{signed(granted)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Spent this month</dt>
            <dd className="tabular-nums">{signed(-MONTH_TOTAL)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Month started</dt>
            <dd>
              <DateTime value={MONTH_START} day /> (UTC)
            </dd>
          </div>
        </dl>
      </section>

      <StatementTable rows={STATEMENT} hidden={HIDDEN_ENTRIES} />

      <section aria-label="This month" className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Where this month&rsquo;s credits went</h2>
        <div className="grid gap-8 sm:grid-cols-2">
          <SummaryList
            heading="By kind of use"
            rows={MONTH_GROUPS.map((g) => ({
              key: g.key,
              label: g.label,
              note: g.help,
              value: fmt(g.credits),
            }))}
            total={fmt(MONTH_TOTAL)}
          />
          <SummaryList
            heading="Workflows, against their budgets"
            rows={WORKFLOWS_BY_SPEND.map((w) => ({
              key: w.id,
              label: w.name,
              note:
                w.paused === "budget_reached" ? (
                  <Badge variant="destructive">Paused: budget reached</Badge>
                ) : w.paused === "failures" ? (
                  <Badge variant="outline">Paused: failing</Badge>
                ) : w.budget !== null && w.spentThisMonth / w.budget >= 0.7 ? (
                  `${String(Math.round((w.spentThisMonth / w.budget) * 100))}% of its budget`
                ) : null,
              value: budgetLine(w.spentThisMonth, w.budget),
            }))}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Workflows count only their live runs. Try it and builder chats about a workflow count
          under their own lines, never against its budget.
        </p>
      </section>
    </PrototypeMain>
  );
}

function SummaryList({
  heading,
  rows,
  total,
}: {
  heading: string;
  rows: { key: string; label: string; note: ReactNode; value: string }[];
  total?: string;
}) {
  return (
    <div className="flex flex-col text-sm">
      <h3 className="border-b pb-2 font-medium">{heading}</h3>
      {rows.map((row) => (
        <div key={row.key} className="flex items-start justify-between gap-4 border-b py-2">
          <span className="flex flex-col gap-1">
            {row.label}
            {row.note ? <span className="text-xs text-muted-foreground">{row.note}</span> : null}
          </span>
          <span className="shrink-0 text-right tabular-nums">{row.value}</span>
        </div>
      ))}
      {total ? (
        <div className="flex justify-between py-2 font-medium">
          <span>Total</span>
          <span className="tabular-nums">{total}</span>
        </div>
      ) : null}
    </div>
  );
}
