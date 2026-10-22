// PROTOTYPE, throwaway: Alerts as full-width bands stacked down the page, in the sidebar shell.
// Each band reads left to right: how urgent and what kind (edge and icon), what happened with
// the context to judge it (failed runs, balance and runway, spend, which inbox), then its one fix
// and what clears it.
import Link from "next/link";
import { DateTime } from "@/components/date-time";
import { cn } from "@/lib/utils";
import type { VariantProps } from "../_shared/prototype-page";
import { SidebarShell } from "../_shared/sidebar-shell";
import { ago, alertsFor, type Alert } from "./alert-data";
import { AlertContext } from "./alert-context";
import { FixButton } from "./alert-parts";
import { AlertsEmpty, MemberAlerts } from "./alert-states";
import {
  aboutOf,
  byUrgency,
  KIND,
  shellParams,
  summaryLine,
  URGENCY,
  URGENCY_EDGE,
  URGENCY_ICON,
  URGENCY_TEXT,
} from "./alert-urgency";

export function VariantE({ params }: VariantProps) {
  const admin = params.as !== "member";
  const alerts = byUrgency(alertsFor(params.state));
  return (
    <SidebarShell
      params={shellParams(params)}
      current="alerts"
      counts={{ alerts: alerts.length }}
      width="wide"
      title="Alerts"
      subtitle={admin ? summaryLine(alerts) : undefined}
    >
      {!admin ? (
        <MemberAlerts state={params.state} />
      ) : alerts.length === 0 ? (
        <AlertsEmpty />
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Open alerts">
          {alerts.map((a) => (
            <AlertBand key={a.id} alert={a} />
          ))}
        </ul>
      )}
    </SidebarShell>
  );
}

function AlertBand({ alert: a }: { alert: Alert }) {
  const tier = URGENCY[a.kind];
  const { label, icon: Icon } = KIND[a.kind];
  const about = aboutOf(a);
  return (
    <li className="flex overflow-hidden rounded-lg border bg-card">
      <span className={cn("w-1 shrink-0", URGENCY_EDGE[tier])} aria-hidden />
      <div className="grid flex-1 gap-4 p-5 md:grid-cols-[auto_minmax(0,1fr)_13rem] md:gap-6">
        <span
          className={cn("flex size-10 items-center justify-center rounded-lg", URGENCY_ICON[tier])}
        >
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-1">
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
              <span className="font-medium">{label}</span>
              <span className="text-muted-foreground">{URGENCY_TEXT[tier].heading}</span>
              <span className="text-muted-foreground md:ml-auto">
                {a.since === undefined ? (
                  "Worked out from this week's usage"
                ) : (
                  <>
                    Started {ago(a.since)}, <DateTime value={a.since} />
                  </>
                )}
              </span>
            </p>
            <h2 className="flex flex-wrap items-baseline gap-x-2 text-base font-semibold">
              <Link href={about.href} className="underline-offset-4 hover:underline">
                {about.name}
              </Link>
              <span className="text-sm font-normal text-muted-foreground">{about.note}</span>
            </h2>
            <p className="max-w-prose text-sm">{a.what}</p>
          </div>
          <div className="rounded-md bg-muted/40 p-3">
            <AlertContext alert={a} />
          </div>
        </div>
        <div className="flex flex-col gap-2 md:items-stretch md:text-right">
          <FixButton
            alert={a}
            variant={tier === "all" ? "default" : "outline"}
            className="md:w-full"
          />
          <p className="text-xs text-muted-foreground">{a.clears}</p>
        </div>
      </div>
    </li>
  );
}
