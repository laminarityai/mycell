// PROTOTYPE, throwaway: Alerts as one table across the full content width, in the sidebar shell.
// Rows run most urgent first, under in-table headings for how much each one stops (everything,
// one workflow or inbox, nothing yet); every row says what it's about, what happened, when it
// started, what clears it, and has its one fix.
import Link from "next/link";
import { DateTime } from "@/components/date-time";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { VariantProps } from "../_shared/prototype-page";
import { SidebarShell } from "../_shared/sidebar-shell";
import { ago, alertsFor, type Alert } from "./alert-data";
import { FixButton } from "./alert-parts";
import { AlertsEmpty, MemberAlerts } from "./alert-states";
import {
  aboutOf,
  byUrgency,
  clearsWhen,
  KIND,
  shellParams,
  summaryLine,
  URGENCY,
  URGENCY_EDGE,
  URGENCY_ICON,
  URGENCY_TEXT,
  type Urgency,
} from "./alert-urgency";

const TIERS: Urgency[] = ["all", "one", "soon"];

export function VariantD({ params }: VariantProps) {
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
        <div className="rounded-lg border">
          <Table aria-label="Open alerts">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-48 pl-4">Kind</TableHead>
                <TableHead className="w-56">About</TableHead>
                <TableHead>What happened</TableHead>
                <TableHead className="w-52">Started</TableHead>
                <TableHead className="w-56">Clears when</TableHead>
                <TableHead className="w-44 pr-4 text-right">Fix</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {TIERS.map((tier) => {
                const rows = alerts.filter((a) => URGENCY[a.kind] === tier);
                if (rows.length === 0) return null;
                return [
                  <TierRow key={tier} tier={tier} count={rows.length} />,
                  ...rows.map((a) => <AlertRow key={a.id} alert={a} />),
                ];
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </SidebarShell>
  );
}

function TierRow({ tier, count }: { tier: Urgency; count: number }) {
  const { heading, note } = URGENCY_TEXT[tier];
  return (
    <TableRow className="bg-muted/40 hover:bg-muted/40">
      <TableCell colSpan={6} className="py-1.5 pl-4">
        <span className="flex items-center gap-2 text-xs">
          <span className={cn("size-2 rounded-full", URGENCY_EDGE[tier])} aria-hidden />
          <span className="font-medium text-foreground">
            {heading} ({count})
          </span>
          <span className="text-muted-foreground">{note}</span>
        </span>
      </TableCell>
    </TableRow>
  );
}

function AlertRow({ alert: a }: { alert: Alert }) {
  const tier = URGENCY[a.kind];
  const { label, icon: Icon } = KIND[a.kind];
  const about = aboutOf(a);
  return (
    <TableRow className="align-top">
      <TableCell className="pl-4">
        <span className="flex items-center gap-2.5">
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-md",
              URGENCY_ICON[tier],
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </span>
          <span className="font-medium">{label}</span>
        </span>
      </TableCell>
      <TableCell className="whitespace-normal">
        <Link href={about.href} className="font-medium underline-offset-4 hover:underline">
          {about.name}
        </Link>
        <span className="block text-xs text-muted-foreground">{about.note}</span>
      </TableCell>
      <TableCell className="min-w-72 whitespace-normal text-muted-foreground">{a.what}</TableCell>
      <TableCell className="whitespace-normal">
        {a.since === undefined ? (
          <span className="text-muted-foreground">Worked out from this week&apos;s usage</span>
        ) : (
          <>
            <span className="block">{ago(a.since)}</span>
            <span className="block text-xs text-muted-foreground">
              <DateTime value={a.since} />
            </span>
          </>
        )}
      </TableCell>
      <TableCell className="whitespace-normal text-muted-foreground">{clearsWhen(a)}</TableCell>
      <TableCell className="pr-4 text-right">
        <FixButton alert={a} variant={tier === "all" ? "default" : "outline"} />
      </TableCell>
    </TableRow>
  );
}
