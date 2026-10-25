// The Alerts page's table: one row per open alert, under a heading row for how much its cause
// stops (everything, one workflow or inbox, nothing yet). Each row says what kind it is, what
// it's about, what happened, when it started, what clears it, and has its one fix.
import { Ban, CirclePause, Coins, Gauge, History, type LucideIcon, Unplug } from "lucide-react";
import Link from "next/link";
import { DateTime } from "@/components/date-time";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  ALERT_URGENCIES,
  ALERT_URGENCY,
  type Alert,
  type AlertKind,
  type AlertUrgency,
} from "../types";

const KINDS: Record<AlertKind, { label: string; icon: LucideIcon }> = {
  credits_out: { label: "Out of credits", icon: Ban },
  workflow_failing: { label: "Paused: failing", icon: CirclePause },
  budget_reached: { label: "Budget reached", icon: Gauge },
  connection_reconnect: { label: "Needs reconnecting", icon: Unplug },
  backfill_failed: { label: "Backfill failed", icon: History },
  credits_low: { label: "Credits low", icon: Coins },
};

const URGENCIES: Record<
  AlertUrgency,
  { heading: string; note: string; dot: string; icon: string }
> = {
  everything: {
    heading: "Stops everything",
    note: "Nothing runs until it's fixed.",
    dot: "bg-destructive",
    icon: "bg-destructive/10 text-destructive",
  },
  one: {
    heading: "Stops a workflow or an inbox",
    note: "The rest keeps running.",
    dot: "bg-amber-500",
    icon: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  },
  later: {
    heading: "Can wait a day",
    note: "Nothing has stopped yet.",
    dot: "bg-muted-foreground/40",
    icon: "bg-muted text-muted-foreground",
  },
};

export function AlertsTable({ alerts }: { alerts: Alert[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table aria-label="Open alerts">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-4">Kind</TableHead>
            <TableHead>About</TableHead>
            <TableHead>What happened</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Clears when</TableHead>
            <TableHead className="pr-4 text-right">Fix</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ALERT_URGENCIES.flatMap((urgency) => {
            const rows = alerts.filter((alert) => ALERT_URGENCY[alert.kind] === urgency);
            if (rows.length === 0) return [];
            return [
              <UrgencyRow key={urgency} urgency={urgency} count={rows.length} />,
              ...rows.map((alert) => <AlertRow key={alert.id} alert={alert} />),
            ];
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function UrgencyRow({ urgency, count }: { urgency: AlertUrgency; count: number }) {
  const { heading, note, dot } = URGENCIES[urgency];
  return (
    <TableRow className="bg-muted/40 hover:bg-muted/40">
      <TableCell colSpan={6} className="py-1.5 pl-4">
        <span className="flex items-center gap-2 text-xs">
          <span className={cn("size-2 rounded-full", dot)} aria-hidden />
          <span className="font-medium">
            {heading} ({count})
          </span>
          <span className="text-muted-foreground">{note}</span>
        </span>
      </TableCell>
    </TableRow>
  );
}

function AlertRow({ alert }: { alert: Alert }) {
  const urgency = ALERT_URGENCY[alert.kind];
  const { label, icon: Icon } = KINDS[alert.kind];
  const about = aboutOf(alert);
  return (
    <TableRow className="align-top">
      <TableCell className="pl-4">
        <span className="flex items-center gap-2.5">
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-md",
              URGENCIES[urgency].icon,
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </span>
          <span className="font-medium">{label}</span>
        </span>
      </TableCell>
      <TableCell className="whitespace-normal">
        <Link
          href={about.href}
          className="font-medium break-all underline-offset-4 hover:underline"
        >
          {about.name}
        </Link>
        <span className="block text-xs text-muted-foreground">{about.note}</span>
      </TableCell>
      <TableCell className="min-w-64 whitespace-normal text-muted-foreground">
        {alert.sentence}
      </TableCell>
      <TableCell className="whitespace-normal">
        {alert.startedAt !== null ? (
          // A budget reached is known only to the UTC day.
          <DateTime value={alert.startedAt} day={alert.kind === "budget_reached"} />
        ) : (
          <span className="text-muted-foreground">
            {alert.kind === "credits_low" ? "Worked out from this week's usage" : "Not recorded"}
          </span>
        )}
      </TableCell>
      <TableCell className="min-w-40 whitespace-normal text-muted-foreground">
        {alert.clearsWhen}
      </TableCell>
      <TableCell className="pr-4 text-right">
        <Button asChild size="sm" variant={urgency === "everything" ? "default" : "outline"}>
          <Link href={alert.fix.href}>{alert.fix.label}</Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}

/** What an alert is about, what kind of thing that is, and where it lives in Mycel. */
function aboutOf(alert: Alert): { name: string; note: string; href: string } {
  const { subject } = alert;
  if (subject.type === "credits") {
    return { name: "Credits", note: "Company balance", href: "/credits" };
  }
  if (subject.type === "workflow") {
    return { name: subject.name, note: "Workflow", href: `/workflows/${subject.id}` };
  }
  return {
    name: subject.accountEmail,
    note: subject.kind === "org" ? "Org connection" : "Your connection",
    href: "/connections",
  };
}
