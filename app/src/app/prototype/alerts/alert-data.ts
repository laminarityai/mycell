// PROTOTYPE, throwaway: the open alerts `listAlerts(ctx)` would compute from the shared fixtures'
// state. Nothing is stored: each alert holds while its cause does, and the `state` toggle moves
// the company between "credits low", "credits out" and "all fixed".
import {
  CONNECTIONS,
  CREDITS,
  NOW,
  PAUSED_TEXT,
  WORKFLOWS,
  type PausedReason,
} from "../_shared/fixtures";

export type AlertKind =
  | "workflow_failing"
  | "credits_low"
  | "credits_out"
  | "budget_reached"
  | "connection_reconnect"
  | "backfill_failed";

export type AlertGroup = "Workflows" | "Credits" | "Connections";

export type Alert = {
  id: string;
  kind: AlertKind;
  group: AlertGroup;
  /** The workflow or connection it's about, or "Credits". */
  subject: string;
  /** A short name for what happened. */
  title: string;
  /** What happened, in a sentence or two. */
  what: string;
  /** When it started, where Mycel knows. */
  since?: Date;
  fix: { label: string; href: string } | { label: string; stub: string };
  /** How it goes away by itself. */
  clears: string;
};

export const STATE_TOGGLE = { param: "state", options: ["low", "out", "clear"] };

const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

export const KIND_ORDER: AlertKind[] = [
  "credits_out",
  "workflow_failing",
  "credits_low",
  "budget_reached",
  "connection_reconnect",
  "backfill_failed",
];

export function alertsFor(state: string): Alert[] {
  if (state === "clear") return [];
  const alerts: Alert[] = [];
  if (state === "out") {
    alerts.push({
      id: "a-credits-out",
      kind: "credits_out",
      group: "Credits",
      subject: "Credits",
      title: "Out of credits",
      what: "Credits ran out. Every workflow is paused, and Ask Mycel and the builder chat can't answer until more are added.",
      since: minutesAgo(42),
      fix: { label: "See credits", href: "/prototype/credits" },
      clears: "Goes away once credits are added.",
    });
  } else {
    const days = 5;
    alerts.push({
      id: "a-credits-low",
      kind: "credits_low",
      group: "Credits",
      subject: "Credits",
      title: "Credits run out in about 5 days",
      what: `At this week's rate (${String(CREDITS.dailyAverage7d)} a day), the ${new Intl.NumberFormat("en-US").format(CREDITS.balance)} credits left last about ${String(days)} days.`,
      fix: { label: "See credits", href: "/prototype/credits" },
      clears: "Goes away once more than 7 days are left.",
    });
  }
  for (const w of WORKFLOWS) {
    if (w.paused === "failures") {
      alerts.push({
        id: `a-failing-${w.id}`,
        kind: "workflow_failing",
        group: "Workflows",
        subject: w.name,
        title: "Paused for failing",
        what: `${w.name} failed 3 runs in a row (${(w.pausedByRunIds ?? []).join(", ")}) and paused itself everywhere.`,
        since: w.pausedSince,
        fix: { label: "Open the workflow", href: "/prototype/workflow-status?state=failing" },
        clears: "Goes away when you resume it.",
      });
    }
    if (w.budget !== null && w.spentThisMonth >= w.budget) {
      alerts.push({
        id: `a-budget-${w.id}`,
        kind: "budget_reached",
        group: "Workflows",
        subject: w.name,
        title: "Monthly budget reached",
        what: `${w.name} has spent ${String(w.spentThisMonth)} of its ${String(w.budget)} credits this month and is paused until November.`,
        since: w.pausedSince,
        fix: { label: "Raise the budget", href: "/prototype/workflow-status?state=budget" },
        clears: "Goes away when you raise the budget, or on Nov 1.",
      });
    }
  }
  if (state === "out") {
    alerts.push({
      id: "a-reconnect-c-dana",
      kind: "connection_reconnect",
      group: "Connections",
      subject: "dana@fernhill.co (yours)",
      title: "Needs reconnecting",
      what: "Google stopped accepting Mycel's access to your inbox, so workflows on it can't run.",
      since: minutesAgo(25),
      fix: { label: "Reconnect Google", href: "/connections" },
      clears: "Goes away once you reconnect.",
    });
  }
  for (const c of CONNECTIONS) {
    if (c.kind === "org" && c.status === "backfill_failed") {
      alerts.push({
        id: `a-backfill-${c.id}`,
        kind: "backfill_failed",
        group: "Connections",
        subject: `${c.label} (shared)`,
        title: "Couldn't read its past mail",
        what: "New mail is fine, but reading its past mail failed, so Discovery and memory don't know what's in it.",
        since: c.since,
        fix: { label: "Read past mail again", stub: "Started reading past mail again." },
        clears: "Goes away once the read finishes.",
      });
    }
  }
  return alerts.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

export const pausedWords = (reason: PausedReason) => PAUSED_TEXT[reason];

/** What a member sees instead: their own pauses and their own connection, no alerts. */
export function memberNotices(state: string) {
  const pauses = WORKFLOWS.filter((w) => w.credentials === "member").flatMap((w) => {
    if (state === "out") return [{ name: w.name, reason: pausedWords("out_of_credits") }];
    if (state === "clear" || w.paused === null) return [];
    return [{ name: w.name, reason: pausedWords(w.paused) }];
  });
  return { pauses, waitingReviews: 6 };
}

/** "42 min ago", "3 h ago", "yesterday", from the prototypes' fixed now. */
export function ago(date: Date): string {
  const minutes = Math.round((NOW.getTime() - date.getTime()) / 60_000);
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)} h ago`;
  return hours < 48 ? "yesterday" : `${String(Math.round(hours / 24))} days ago`;
}
