// PROTOTYPE, throwaway: the switches on the Workflows page, each with the pauses that hold on
// it, and M7's single display order (issue 152, "One pause model for display"): the first
// reason that holds is the one shown.
import { NOW, PAUSED_TEXT, type PausedReason, workflowById } from "../_shared/fixtures";

const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

/** M7's order: out of credits first, since only an admin can lift it, outside Mycel. */
export const ORDER: PausedReason[] = [
  "out_of_credits",
  "failures",
  "budget_reached",
  "needs_reenable",
];

/** When the company's credits ran out, with `credits=out`. */
export const CREDITS_OUT_SINCE = minutesAgo(40);

/** When a budget pause lifts by itself: the first of next month, UTC. */
export const NEXT_MONTH = new Date("2026-11-01T00:00:00Z");

export type BaseSwitch = {
  id: string;
  name: string;
  apps: string[];
  /** A member's own enablement, or the org switch on a shared inbox. */
  kind: "member" | "org";
  on: boolean;
  /** Pauses that hold whatever the balance. */
  stored: PausedReason[];
  since: Partial<Record<PausedReason, Date>>;
  riskRaised?: { from: string; to: string; version: number };
  budget?: { spent: number; limit: number };
  failedRunIds?: string[];
};

export type PauseRow = BaseSwitch & {
  /** Every pause that holds, in display order; the first is the one shown. */
  reasons: PausedReason[];
};

function fromShared(id: string, kind: "member" | "org", on: boolean): BaseSwitch {
  const wf = workflowById(id);
  if (wf === undefined) return { id, name: id, apps: [], kind, on, stored: [], since: {} };
  return {
    id: wf.id,
    name: wf.name,
    apps: wf.apps,
    kind,
    on,
    stored: wf.paused === null ? [] : [wf.paused],
    since: wf.paused === null ? {} : { [wf.paused]: wf.pausedSince },
    budget: wf.budget === null ? undefined : { spent: wf.spentThisMonth, limit: wf.budget },
    failedRunIds: wf.pausedByRunIds,
  };
}

/** The switches on a member's own Google account. */
export const MEMBER_SWITCHES: BaseSwitch[] = [
  fromShared("wf-quotes", "member", true),
  fromShared("wf-followups", "member", true),
  fromShared("wf-calls", "member", true),
  {
    id: "wf-chase",
    name: "Chase unpaid invoices",
    apps: ["Gmail", "Sheets"],
    kind: "member",
    on: true,
    stored: ["needs_reenable"],
    since: { needs_reenable: minutesAgo(60 * 26) },
    riskRaised: { from: "Internal, reversible", to: "External send", version: 4 },
  },
  {
    id: "wf-delivery",
    name: "Draft replies to delivery questions",
    apps: ["Gmail"],
    kind: "member",
    on: false,
    stored: [],
    since: {},
  },
];

/** The shared-inbox switches an admin manages. */
export const ORG_SWITCHES: BaseSwitch[] = [
  fromShared("wf-invoices", "org", true),
  fromShared("wf-status", "org", true),
  {
    id: "wf-sort-orders",
    name: "Sort the orders inbox",
    apps: ["Gmail", "Sheets"],
    kind: "org",
    on: true,
    stored: ["budget_reached"],
    since: { budget_reached: minutesAgo(60 * 9) },
    budget: { spent: 503, limit: 500 },
  },
];

/** A switch's pauses in display order, with credits out adding to every switched-on one. */
export function withReasons(
  base: BaseSwitch,
  creditsOut: boolean,
  lifted: PausedReason[],
): PauseRow {
  const holding = new Set(base.stored.filter((reason) => !lifted.includes(reason)));
  if (creditsOut && base.on) holding.add("out_of_credits");
  const since = creditsOut ? { ...base.since, out_of_credits: CREDITS_OUT_SINCE } : base.since;
  return {
    ...base,
    since,
    reasons: base.on ? ORDER.filter((reason) => holding.has(reason)) : [],
  };
}

/** "Paused: budget reached". */
export const pausedLabel = (reason: PausedReason) => `Paused: ${PAUSED_TEXT[reason]}`;

/** "40 minutes", "26 hours", "2 days": how long a pause has held. */
export function heldFor(since: Date): string {
  const minutes = Math.max(1, Math.floor((NOW.getTime() - since.getTime()) / 60_000));
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return plural(hours, "hour");
  return plural(Math.floor(hours / 24), "day");
}

function plural(count: number, unit: string) {
  return `${String(count)} ${unit}${count === 1 ? "" : "s"}`;
}
