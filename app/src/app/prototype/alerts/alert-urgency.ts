// PROTOTYPE, throwaway: what round 2's full-width variants (D, E) add to the alerts: how urgent
// each kind is, the order that follows from it, a short name and icon per kind, where the thing
// an alert is about lives, and the params the sidebar shell gets (`state=out` means credits out).
import { Ban, Coins, Gauge, History, TriangleAlert, Unplug, type LucideIcon } from "lucide-react";
import type { Alert, AlertKind } from "./alert-data";

/** Stops everything, stops one workflow or inbox, or can wait a day. */
export type Urgency = "all" | "one" | "soon";

export const URGENCY: Record<AlertKind, Urgency> = {
  credits_out: "all",
  workflow_failing: "one",
  budget_reached: "one",
  connection_reconnect: "one",
  backfill_failed: "soon",
  credits_low: "soon",
};

export const URGENCY_TEXT: Record<Urgency, { heading: string; note: string }> = {
  all: { heading: "Stops everything", note: "Nothing runs until it's fixed." },
  one: { heading: "Stops a workflow or an inbox", note: "The rest keeps running." },
  soon: { heading: "Can wait a day", note: "Nothing has stopped yet." },
};

/** The urgency edge: red stops everything, amber stops one thing, grey can wait. */
export const URGENCY_EDGE: Record<Urgency, string> = {
  all: "bg-red-600",
  one: "bg-amber-500",
  soon: "bg-zinc-300 dark:bg-zinc-600",
};

export const URGENCY_ICON: Record<Urgency, string> = {
  all: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  one: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  soon: "bg-muted text-muted-foreground",
};

const ORDER: AlertKind[] = [
  "credits_out",
  "workflow_failing",
  "budget_reached",
  "connection_reconnect",
  "backfill_failed",
  "credits_low",
];

export const byUrgency = (alerts: Alert[]) =>
  [...alerts].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));

export const KIND: Record<AlertKind, { label: string; icon: LucideIcon }> = {
  credits_out: { label: "Out of credits", icon: Ban },
  workflow_failing: { label: "Paused for failing", icon: TriangleAlert },
  budget_reached: { label: "Budget reached", icon: Gauge },
  connection_reconnect: { label: "Needs reconnecting", icon: Unplug },
  backfill_failed: { label: "Past mail unread", icon: History },
  credits_low: { label: "Credits low", icon: Coins },
};

/** What the alert is about, as a name, what kind of thing it is, and a link to it. */
export function aboutOf(a: Alert): { name: string; note: string; href: string } {
  if (a.group === "Credits") {
    return { name: "Credits", note: "Company balance", href: "/prototype/credits" };
  }
  if (a.group === "Workflows") {
    const state = a.kind === "budget_reached" ? "budget_reached" : "failing";
    return {
      name: a.subject,
      note: "Workflow",
      href: `/prototype/workflow-status?state=${state}&variant=C`,
    };
  }
  const shared = a.subject.endsWith("(shared)");
  return {
    name: a.subject.replace(/ \((yours|shared)\)$/, ""),
    note: shared ? "Shared inbox" : "Your inbox",
    href: "/connections",
  };
}

/** The shell shows the admin's out-of-credits banner when `credits=out`, or `state=out` here. */
export const shellParams = (params: Record<string, string>) => ({
  ...params,
  credits: params.state === "out" ? "out" : params.credits,
});

export function summaryLine(alerts: Alert[]): string {
  if (alerts.length === 0) return "No open alerts. They appear here when something needs you.";
  const count = alerts.length === 1 ? "1 open alert" : `${String(alerts.length)} open alerts`;
  const stopsAll = alerts.some((a) => URGENCY[a.kind] === "all");
  return `${count}${stopsAll ? ", one of them stopping everything" : ""}. They clear by themselves once fixed.`;
}

/** "Goes away once credits are added." as "Once credits are added.", for a column headed so. */
export const clearsWhen = (a: Alert) =>
  a.clears.replace(/^Goes away (\w)/, (_, first: string) => first.toUpperCase());
