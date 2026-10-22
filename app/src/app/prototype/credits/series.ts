// PROTOTYPE, throwaway: the Credits page's day-by-day story, Oct 1 to today, per kind of use and
// per workflow. Every series sums to the shared fixtures' month (CREDITS.monthByGroup and each
// workflow's spentThisMonth), and the last 7 days average CREDITS.dailyAverage7d. Sam connected
// his mailbox on Oct 16, so quote replies and memory both jump from then. `credits=out` adds a
// memory surge that spends the rest of the balance this morning.
import { InvariantError } from "@/lib/errors";
import { CREDITS, LEDGER, NOW, WORKFLOWS, type Workflow } from "../_shared/fixtures";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The first of this month and of the next, UTC: what "this month" counts between. */
export const MONTH_START = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), 1));
export const NEXT_MONTH = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + 1, 1));

/** Oct 1 … Oct 22 (today, still under way). */
export const DAYS = Array.from(
  { length: 22 },
  (_, i) => new Date(MONTH_START.getTime() + i * DAY_MS),
);

/** Live-run credits per workflow per day. Weekends are quiet; Oct 21 Book customer calls hit
 * its budget; Follow-up tasks paused after failures today. */
export const WORKFLOW_DAILY: Record<string, number[]> = {
  "wf-quotes": [
    52, 57, 14, 16, 57, 47, 52, 57, 46, 16, 17, 46, 52, 57, 46, 159, 52, 42, 159, 172, 140, 96,
  ],
  "wf-invoices": [20, 22, 4, 4, 22, 18, 20, 22, 18, 4, 5, 18, 21, 22, 18, 30, 7, 5, 30, 33, 27, 18],
  "wf-calls": [
    48, 53, 11, 12, 53, 43, 48, 52, 43, 12, 13, 42, 48, 52, 42, 50, 12, 10, 58, 60, 50, 0,
  ],
  "wf-status": [0, 32, 0, 0, 0, 0, 0, 0, 32, 0, 0, 0, 0, 0, 0, 32, 0, 0, 0, 0, 0, 0],
  "wf-followups": [12, 14, 3, 4, 14, 11, 12, 14, 11, 4, 4, 11, 12, 14, 11, 19, 6, 5, 19, 20, 16, 5],
};

export type KindKey = "workflows" | "memory" | "builder" | "agent" | "try_it" | "injection_screen";

const sumDays = (series: number[][]) => DAYS.map((_, i) => series.reduce((s, v) => s + v[i], 0));
const total = (series: number[]) => series.reduce((a, b) => a + b, 0);

/** Credits per kind of use per day. Builder chat and Try it were busiest while workflows were
 * being built early in the month. */
export const KIND_DAILY: Record<KindKey, number[]> = {
  workflows: sumDays(Object.values(WORKFLOW_DAILY)),
  memory: [
    91, 87, 55, 52, 77, 85, 90, 89, 81, 53, 53, 83, 90, 90, 84, 183, 91, 87, 157, 150, 144, 78,
  ],
  builder: [107, 100, 23, 22, 80, 73, 67, 60, 53, 12, 10, 33, 27, 20, 13, 32, 8, 8, 31, 31, 31, 19],
  agent: [10, 11, 5, 5, 13, 14, 15, 16, 16, 7, 7, 19, 20, 21, 21, 22, 9, 9, 24, 25, 26, 16],
  try_it: [37, 35, 6, 6, 28, 25, 23, 21, 19, 3, 3, 12, 10, 7, 5, 15, 3, 3, 14, 14, 14, 9],
  injection_screen: [2, 2, 1, 1, 2, 2, 2, 2, 2, 1, 1, 2, 2, 2, 2, 2, 1, 1, 2, 2, 2, 2],
};

/** The bottom-to-top order every stack and list uses. */
export const KIND_ORDER: KindKey[] = [
  "workflows",
  "memory",
  "builder",
  "agent",
  "try_it",
  "injection_screen",
];

/** With `credits=out`: a big memory backfill from Oct 19 spends the rest of the balance. */
const OUT_MEMORY_EXTRA = [...Array<number>(18).fill(0), 300, 700, 1300, 1120];

/** With `credits=out`, when the balance reached zero. */
export const OUT_AT = new Date(Date.UTC(2026, 9, 22, 9, 40));

/** The October allowance, granted on the 1st. */
export const GRANTED = LEDGER.filter((e) => e.kind === "grant" && e.at >= MONTH_START).reduce(
  (sum, e) => sum + e.credits,
  0,
);

export type CreditScenario = {
  out: boolean;
  balance: number;
  spent: number;
  kinds: Record<KindKey, number[]>;
  /** All kinds per day. */
  daily: number[];
  /** The last 7 days' average a day. */
  rate: number;
  /** When the balance reaches zero at that rate; when it did, if out. */
  zeroAt: Date;
  /** The balance at Oct 1, at each day's end, and now. */
  balances: { at: Date; balance: number }[];
};

export function creditScenario(out: boolean): CreditScenario {
  const kinds = out
    ? { ...KIND_DAILY, memory: KIND_DAILY.memory.map((v, i) => v + OUT_MEMORY_EXTRA[i]) }
    : KIND_DAILY;
  const daily = sumDays(KIND_ORDER.map((k) => kinds[k]));
  const spent = total(daily);
  const balance = GRANTED - spent;
  const rate = Math.round(total(daily.slice(-7)) / 7);
  let left = GRANTED;
  const balances = [
    { at: MONTH_START, balance: GRANTED },
    ...daily.map((v, i) => {
      left -= v;
      const last = i === daily.length - 1;
      const at = last ? (out ? OUT_AT : NOW) : new Date(DAYS[i].getTime() + DAY_MS);
      return { at, balance: left };
    }),
  ];
  const zeroAt = out ? OUT_AT : new Date(NOW.getTime() + (balance / rate) * DAY_MS);
  return { out, balance, spent, kinds, daily, rate, zeroAt, balances };
}

export const OK_SCENARIO = creditScenario(false);
export const OUT_SCENARIO = creditScenario(true);

const agrees =
  OK_SCENARIO.balance === CREDITS.balance &&
  OK_SCENARIO.rate === CREDITS.dailyAverage7d &&
  KIND_ORDER.every((k) => total(KIND_DAILY[k]) === CREDITS.monthByGroup[k]) &&
  WORKFLOWS.every((w) => total(WORKFLOW_DAILY[w.id]) === w.spentThisMonth);
if (!agrees) throw new InvariantError("The credits series disagree with the shared fixtures.");

export type WorkflowTrack = {
  workflow: Workflow;
  daily: number[];
  /** Spent by the end of each day. */
  cumulative: number[];
  last7: number;
  /** The reason shown, out of credits first. */
  paused: Workflow["paused"];
  pausedAt: Date | null;
  /** Where the month ends at the last 7 days' rate: paused stays put, a budget caps it. */
  projected: { at: Date; spent: number }[];
};

export function workflowTrack(workflow: Workflow, out: boolean): WorkflowTrack {
  const daily = WORKFLOW_DAILY[workflow.id];
  let sum = 0;
  const cumulative = daily.map((v) => (sum += v));
  const last7 = total(daily.slice(-7));
  const paused = out ? "out_of_credits" : workflow.paused;
  const pausedAt = out
    ? new Date(Math.min(OUT_AT.getTime(), workflow.pausedSince?.getTime() ?? Infinity))
    : (workflow.pausedSince ?? null);
  const spent = workflow.spentThisMonth;
  const rate = paused === null ? last7 / 7 : 0;
  const cap = workflow.budget ?? Infinity;
  const toEnd = (NEXT_MONTH.getTime() - NOW.getTime()) / DAY_MS;
  const projected = [{ at: NOW, spent }];
  if (rate > 0 && spent + rate * toEnd > cap) {
    const reach = new Date(NOW.getTime() + ((cap - spent) / rate) * DAY_MS);
    projected.push({ at: reach, spent: cap }, { at: NEXT_MONTH, spent: cap });
  } else {
    projected.push({ at: NEXT_MONTH, spent: Math.round(spent + rate * toEnd) });
  }
  return { workflow, daily, cumulative, last7, paused, pausedAt, projected };
}

/** Workflows by this month's spending, most first. */
export const tracksFor = (out: boolean) =>
  [...WORKFLOWS]
    .sort((a, b) => b.spentThisMonth - a.spentThisMonth)
    .map((w) => workflowTrack(w, out));
