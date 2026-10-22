// PROTOTYPE, throwaway: the two states round 2's variants share. No open alerts (`state=clear`),
// and a member who followed a link to Alerts: members get no alerts, so the page says who does
// and shows what is theirs, where they already look for it.
import { CircleCheck, ShieldUser } from "lucide-react";
import Link from "next/link";
import { formatCredits, CREDIT_STATUS } from "../shell/nav-model";
import { memberNotices } from "./alert-data";

export function AlertsEmpty() {
  return (
    <div className="flex flex-col items-start gap-4 rounded-lg border border-dashed px-6 py-10 sm:flex-row sm:items-center sm:gap-5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
        <CircleCheck className="size-5" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <p className="font-medium">Nothing needs you.</p>
        <p className="max-w-prose text-sm text-muted-foreground">
          An alert appears here when a workflow pauses for failing or reaches its budget, credits
          run low or out, or an inbox needs reconnecting. Each one goes away once its cause is
          fixed; there&apos;s nothing to dismiss.
        </p>
      </div>
      <p className="text-sm text-muted-foreground sm:ml-auto sm:text-right">
        {formatCredits(CREDIT_STATUS.balance)} credits left,
        <br className="hidden sm:block" /> about {CREDIT_STATUS.runwayDays} days at this week&apos;s
        rate
      </p>
    </div>
  );
}

export function MemberAlerts({ state }: { state: string }) {
  const { pauses, waitingReviews } = memberNotices(state);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex items-start gap-4 rounded-lg border bg-muted/30 p-5">
        <ShieldUser className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="flex flex-col gap-1">
          <p className="font-medium">Alerts are for admins</p>
          <p className="text-sm text-muted-foreground">
            Dana Ruiz and the other admins get them, and fix what they&apos;re about: failing
            workflows, budgets, credits and shared inboxes. What&apos;s yours shows below and on
            your own pages.
          </p>
        </div>
      </div>
      <section className="flex flex-col gap-2" aria-label="Yours right now">
        <h2 className="text-sm font-semibold">Yours right now</h2>
        <ul className="flex flex-col divide-y rounded-lg border text-sm">
          <li className="flex items-center justify-between gap-4 px-4 py-3">
            <span>{waitingReviews} reviews wait for you</span>
            <Link href="/prototype/review-cards" className="underline underline-offset-4">
              Open reviews
            </Link>
          </li>
          {pauses.map((p) => (
            <li key={p.name} className="flex items-center justify-between gap-4 px-4 py-3">
              <span>{p.name}</span>
              <span className="text-muted-foreground">Paused: {p.reason}</span>
            </li>
          ))}
          <li className="flex items-center justify-between gap-4 px-4 py-3">
            <span>priya@fernhill.co</span>
            <span className="text-muted-foreground">Connected</span>
          </li>
        </ul>
      </section>
    </div>
  );
}
