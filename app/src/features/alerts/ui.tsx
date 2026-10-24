// Admins' alerts on screen: the Alerts page (a one-line summary, then the open alerts grouped by
// how much they stop, or that nothing needs them) and the banner the app shell shows on every
// page while the company is out of credits.
import { CircleAlert, CircleCheck } from "lucide-react";
import Link from "next/link";
import { AlertsTable } from "./lib/alerts-table";
import { ALERT_URGENCY, type Alert } from "./types";

export function AlertsOverview({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return <AlertsEmpty />;
  return (
    <>
      <p className="text-sm text-muted-foreground">{summaryLine(alerts)}</p>
      <AlertsTable alerts={alerts} />
    </>
  );
}

/** "4 open alerts, one of them stopping everything. They clear by themselves once fixed." */
function summaryLine(alerts: Alert[]): string {
  const count = alerts.length === 1 ? "1 open alert" : `${String(alerts.length)} open alerts`;
  const stopping = alerts.some((alert) => ALERT_URGENCY[alert.kind] === "everything")
    ? alerts.length === 1
      ? ", stopping everything"
      : ", one of them stopping everything"
    : "";
  return `${count}${stopping}. They clear by themselves once fixed.`;
}

function AlertsEmpty() {
  return (
    <div className="flex flex-col items-start gap-4 rounded-lg border border-dashed px-6 py-10 sm:flex-row sm:items-center sm:gap-5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
        <CircleCheck className="size-5" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <p className="font-medium">Nothing needs you.</p>
        <p className="max-w-prose text-sm text-muted-foreground">
          An alert appears here when credits run low or out, or a connection needs reconnecting or
          couldn&apos;t read its history. Each one goes away once its cause is fixed; there&apos;s
          nothing to dismiss.
        </p>
      </div>
    </div>
  );
}

/** Across every page, for admins, while the company is out of credits. */
export function OutOfCreditsBanner() {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive md:px-8"
    >
      <CircleAlert className="size-4 shrink-0" aria-hidden />
      <p className="flex-1">
        <span className="font-medium">Your company is out of credits.</span> Every workflow is
        paused and no runs start. They resume by themselves once the Mycel team grants more.
      </p>
      <Link href="/credits" className="font-medium underline underline-offset-4">
        See credits
      </Link>
    </div>
  );
}
