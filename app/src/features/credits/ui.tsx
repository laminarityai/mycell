// The Credits page (M7, admins only): where the company stands now, one chart with three lenses
// over this month, the breakdown by kind of use and by workflow beneath it, and the latest
// ledger entries.
import { DateTime } from "@/components/date-time";
import { cn } from "@/lib/utils";
import { formatCredits } from "./format";
import { LedgerTable } from "./lib/ledger-table";
import { LensPanel } from "./lib/lens-panel";
import type { ChartLens, LedgerLine, Runway, SpendingSummary, WorkflowSpendingLine } from "./types";

export function CreditsOverview({
  now,
  runway,
  summary,
  workflows,
  entries,
  lens,
}: {
  now: Date;
  runway: Runway;
  summary: SpendingSummary;
  workflows: WorkflowSpendingLine[];
  entries: LedgerLine[];
  /** What the chart plots first: the balance unless the page asks otherwise. */
  lens?: ChartLens;
}) {
  return (
    <>
      <SummaryStrip runway={runway} summary={summary} />
      <LensPanel
        summary={summary}
        runway={runway}
        workflows={workflows}
        now={now}
        initialLens={lens}
      />
      <section aria-labelledby="latest-entries" className="flex flex-col gap-2">
        <h2 id="latest-entries" className="text-lg font-semibold">
          Latest entries
        </h2>
        <p className="text-sm text-muted-foreground">
          Newest first: grants from the Mycel team, and what each model call cost.
        </p>
        <LedgerTable entries={entries} />
      </section>
    </>
  );
}

/** The balance and its runway now, and what this month spent and was granted. */
function SummaryStrip({ runway, summary }: { runway: Runway; summary: SpendingSummary }) {
  const out = runway.balance <= 0;
  return (
    <div
      aria-label="Summary"
      role="group"
      className="flex flex-wrap items-baseline gap-x-8 gap-y-2 border-y py-3 text-sm"
    >
      <span>
        <span className="text-muted-foreground">Balance </span>
        <span className={cn("text-base font-semibold tabular-nums", out && "text-destructive")}>
          {formatCredits(runway.balance)}
        </span>
      </span>
      <RunwayText runway={runway} />
      <span>
        <span className="text-muted-foreground">Spent this month </span>
        <span className="font-medium tabular-nums">{formatCredits(summary.spent)}</span>
      </span>
      <span>
        <span className="text-muted-foreground">Granted this month </span>
        <span className="font-medium tabular-nums">{formatCredits(summary.granted)}</span>
      </span>
    </div>
  );
}

function RunwayText({ runway }: { runway: Runway }) {
  if (runway.balance <= 0) {
    return (
      <span className="text-destructive">
        Out of credits: every workflow is paused until the Mycel team grants more
      </span>
    );
  }
  if (runway.days === null || runway.dailyRate === null || runway.zeroAt === null) {
    return <span className="text-muted-foreground">No usage in the last 7 days</span>;
  }
  const days = Math.floor(runway.days);
  return (
    <span>
      <span className="text-muted-foreground">Lasts about </span>
      <span className="font-medium">
        {days} {days === 1 ? "day" : "days"}
      </span>
      <span className="text-muted-foreground">
        {" "}
        (to <DateTime value={runway.zeroAt} day />, at {formatCredits(runway.dailyRate)} a day)
      </span>
    </span>
  );
}
