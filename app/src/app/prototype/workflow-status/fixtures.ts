// PROTOTYPE, throwaway: the one workflow every variant shows ("Reply to quote requests" from the
// shared company), how each `state` toggle sets it up, and the three failed runs a failure
// pause points at (the shared fixtures' pausedByRunIds belong to other workflows' runs).
import { NOW, PEOPLE, workflowById, type Workflow } from "../_shared/fixtures";

const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

export const WORKFLOW = workflowById("wf-quotes") as Workflow;

export const STATES = ["normal", "budget_reached", "failing", "out_of_credits"] as const;
export type StateKey = (typeof STATES)[number];

/** What the page starts from in each state; the stubs change it from there. */
export type Start = {
  spent: number;
  budget: number | null;
  /** M8's stored pause, which only an admin lifts. */
  pausedForFailures: boolean;
  balance: number;
};

export const START: Record<StateKey, Start> = {
  normal: { spent: WORKFLOW.spentThisMonth, budget: 2000, pausedForFailures: false, balance: 3420 },
  budget_reached: { spent: 2014, budget: 2000, pausedForFailures: false, balance: 3420 },
  failing: { spent: WORKFLOW.spentThisMonth, budget: 2000, pausedForFailures: true, balance: 3420 },
  out_of_credits: {
    spent: WORKFLOW.spentThisMonth,
    budget: 2000,
    pausedForFailures: false,
    balance: 0,
  },
};

export const startFor = (state: string): Start =>
  START[(STATES as readonly string[]).includes(state) ? (state as StateKey) : "normal"];

/** When each pause started, for "since". */
export const PAUSED_SINCE = {
  failures: minutesAgo(95),
  budget_reached: minutesAgo(310),
  out_of_credits: minutesAgo(48),
};

export type FailedRun = {
  id: string;
  at: Date;
  inbox: string;
  step: string;
  error: string;
  cost: number;
};

/** Oldest first: the streak that paused it. */
export const FAILED_RUNS: FailedRun[] = [
  {
    id: "r-0981",
    at: minutesAgo(171),
    inbox: PEOPLE.priya.email,
    step: "draft-reply",
    error: "The model's answer didn't fit the schema (missing price_per_unit).",
    cost: 14,
  },
  {
    id: "r-0986",
    at: minutesAgo(132),
    inbox: PEOPLE.sam.email,
    step: "draft-reply",
    error: "The model's answer didn't fit the schema (missing price_per_unit).",
    cost: 13,
  },
  {
    id: "r-0990",
    at: minutesAgo(96),
    inbox: PEOPLE.dana.email,
    step: "draft-reply",
    error: "The model's answer didn't fit the schema (missing price_per_unit).",
    cost: 15,
  },
];

/** The last day's runs, for the runs link. */
export const RUNS_TODAY = { total: 31, succeeded: 26, failed: 3, escalated: 2 };

export const NEXT_MONTH = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + 1, 1));

export const RUNS_HREF = `/prototype/runs?workflow=${WORKFLOW.id}`;
export const runHref = (id: string) => `/prototype/run?id=${id}`;
