// PROTOTYPE, throwaway: Alerts as a to-do list of cards. Each card leads with the thing to do,
// not the thing that broke, and has exactly one button that does it; how urgent it is shows as
// the card's edge.
import { DateTime } from "@/components/date-time";
import { cn } from "@/lib/utils";
import { PrototypeHeader, PrototypeMain } from "../_shared/header";
import type { VariantProps } from "../_shared/prototype-page";
import { ago, alertsFor, type Alert, type AlertKind } from "./alert-data";
import { FixButton, MemberNotices, OutOfCreditsBanner } from "./alert-parts";

const TODO: Record<AlertKind, (a: Alert) => string> = {
  credits_out: () => "Add credits to start everything again",
  workflow_failing: (a) => `Fix and resume ${a.subject}`,
  credits_low: () => "Get more credits before they run out",
  budget_reached: (a) => `Decide whether to raise ${a.subject}'s budget`,
  connection_reconnect: () => "Reconnect your Google account",
  backfill_failed: (a) => `Read ${a.subject.replace(" (shared)", "")}'s past mail again`,
};

/** Stops everything, stops one workflow, or can wait a little. */
const URGENCY: Record<AlertKind, "all" | "one" | "soon"> = {
  credits_out: "all",
  workflow_failing: "one",
  connection_reconnect: "one",
  budget_reached: "one",
  credits_low: "soon",
  backfill_failed: "soon",
};

const EDGE = {
  all: "border-l-red-600",
  one: "border-l-amber-500",
  soon: "border-l-zinc-300 dark:border-l-zinc-600",
};

const URGENCY_WORDS = {
  all: "Everything is stopped",
  one: "Something is stopped",
  soon: "Before it gets worse",
};

export function VariantB({ params }: VariantProps) {
  const admin = params.as === "admin";
  const alerts = alertsFor(params.state);
  return (
    <>
      {admin && params.state === "out" ? <OutOfCreditsBanner /> : null}
      <PrototypeMain wide>
        <PrototypeHeader title={admin ? "Alerts" : "Your notices"} admin={admin} />
        {!admin ? (
          <div className="max-w-2xl">
            <MemberNotices state={params.state} />
          </div>
        ) : (
          <>
            <p className="text-3xl font-semibold tracking-tight">
              {alerts.length === 0
                ? "Nothing needs you right now."
                : alerts.length === 1
                  ? "One thing needs you."
                  : `${String(alerts.length)} things need you.`}
            </p>
            {alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                When a workflow fails, credits run low or a shared inbox needs reconnecting, a card
                appears here. Fixing the cause takes it away; there&apos;s nothing to dismiss.
              </p>
            ) : (
              <ul className="grid gap-4 md:grid-cols-2">
                {alerts.map((a) => (
                  <li
                    key={a.id}
                    className={cn(
                      "flex flex-col gap-3 rounded-lg border border-l-4 bg-card p-5",
                      EDGE[URGENCY[a.kind]],
                    )}
                  >
                    <p className="text-xs text-muted-foreground">
                      {URGENCY_WORDS[URGENCY[a.kind]]}
                    </p>
                    <h2 className="text-lg leading-snug font-semibold">{TODO[a.kind](a)}</h2>
                    <p className="text-sm">{a.what}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.since === undefined ? (
                        "Worked out from this week's usage."
                      ) : (
                        <>
                          Started {ago(a.since)}, <DateTime value={a.since} />.
                        </>
                      )}
                    </p>
                    <div className="mt-auto flex flex-col gap-2 pt-2">
                      <FixButton alert={a} size="lg" variant="default" className="w-full" />
                      <p className="text-center text-xs text-muted-foreground">{a.clears}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </PrototypeMain>
    </>
  );
}
