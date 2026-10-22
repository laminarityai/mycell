// PROTOTYPE, throwaway: the Credits page's own fixtures on top of the shared company: this
// month's daily usage (so balances can be drawn), each workflow's last 7 days, the month by group,
// and running balances for the latest ledger entries. The day-by-day series live in series.ts.
import {
  CREDITS,
  LEDGER,
  NOW,
  WORKFLOWS,
  type LedgerEntry,
  type Workflow,
} from "../_shared/fixtures";
import { DAY_MS, MONTH_START, OK_SCENARIO, WORKFLOW_DAILY } from "./series";

export { MONTH_START };

/** Credits used each day this month, Oct 1 to today. The last 7 average 371 (CREDITS). */
export const DAILY_USAGE = OK_SCENARIO.daily;

/** The balance just after the October allowance landed. */
export const BALANCE_AFTER_GRANT = CREDITS.balance + DAILY_USAGE.reduce((a, b) => a + b, 0);

/** The balance at the end of each day this month (today's is now). */
export const DAILY_BALANCES = DAILY_USAGE.map((_, i) => ({
  day: new Date(MONTH_START.getTime() + i * DAY_MS),
  balance: BALANCE_AFTER_GRANT - DAILY_USAGE.slice(0, i + 1).reduce((a, b) => a + b, 0),
}));

/** When the balance reaches zero at the last 7 days' rate. */
export const RUNS_OUT_AT = new Date(
  NOW.getTime() + (CREDITS.balance / CREDITS.dailyAverage7d) * DAY_MS,
);

export const RUNWAY_DAYS = Math.floor(CREDITS.balance / CREDITS.dailyAverage7d);

export type Group = { key: string; label: string; credits: number; help: string };

/** This month by kind of use. Runs are "Workflows"; Try it never counts against a budget. */
export const MONTH_GROUPS: Group[] = [
  {
    key: "workflows",
    label: "Workflows",
    credits: CREDITS.monthByGroup.workflows,
    help: "Live runs",
  },
  {
    key: "memory",
    label: "Memory",
    credits: CREDITS.monthByGroup.memory,
    help: "Learning facts from mail and files",
  },
  {
    key: "builder",
    label: "Builder chat",
    credits: CREDITS.monthByGroup.builder,
    help: "Building and changing workflows",
  },
  {
    key: "agent",
    label: "Ask Mycel",
    credits: CREDITS.monthByGroup.agent,
    help: "Questions and requests to Mycel",
  },
  {
    key: "try_it",
    label: "Try it",
    credits: CREDITS.monthByGroup.try_it,
    help: "Test runs while editing",
  },
  {
    key: "injection_screen",
    label: "Mail screening",
    credits: CREDITS.monthByGroup.injection_screen,
    help: "Checking incoming mail is safe",
  },
];

export const MONTH_TOTAL = MONTH_GROUPS.reduce((sum, g) => sum + g.credits, 0);

/** Each group's colour: the dataviz reference palette's first six slots, in fixed order. */
export const GROUP_COLOR: Record<string, string> = {
  workflows: "bg-[#2a78d6] dark:bg-[#3987e5]",
  memory: "bg-[#eb6834] dark:bg-[#d95926]",
  builder: "bg-[#1baf7a] dark:bg-[#199e70]",
  agent: "bg-[#eda100] dark:bg-[#c98500]",
  try_it: "bg-[#e87ba4] dark:bg-[#d55181]",
  injection_screen: "bg-[#008300] dark:bg-[#008300]",
};

/** Each workflow's live-run usage over the last 7 days. */
const BURN_7D: Record<string, number> = Object.fromEntries(
  Object.entries(WORKFLOW_DAILY).map(([id, daily]) => [
    id,
    daily.slice(-7).reduce((a, b) => a + b, 0),
  ]),
);

export type WorkflowSpend = Workflow & { burn7d: number; perDay: number };

/** Workflows by how fast they're spending now, fastest first. */
export const WORKFLOWS_BY_BURN: WorkflowSpend[] = WORKFLOWS.map((w) => ({
  ...w,
  burn7d: BURN_7D[w.id] ?? 0,
  perDay: Math.round((BURN_7D[w.id] ?? 0) / 7),
})).sort((a, b) => b.burn7d - a.burn7d);

/** Workflows by this month's spending, most first. */
export const WORKFLOWS_BY_SPEND = [...WORKFLOWS].sort(
  (a, b) => b.spentThisMonth - a.spentThisMonth,
);

export type StatementRow = LedgerEntry & { balanceAfter: number | null };

/**
 * The ledger newest first, each entry with the balance just after it. The recent entries count
 * back from today's balance; the grant shows the balance it made. Older grants have none here.
 */
export const STATEMENT: StatementRow[] = (() => {
  let balance = CREDITS.balance;
  return LEDGER.map((entry): StatementRow => {
    if (entry.kind === "grant") {
      const isThisMonth = entry.at >= MONTH_START;
      return { ...entry, balanceAfter: isThisMonth ? BALANCE_AFTER_GRANT : null };
    }
    const after = balance;
    balance -= entry.credits;
    return { ...entry, balanceAfter: after };
  });
})();

/** How many ledger entries the statement doesn't list between the recent ones and the grant. */
export const HIDDEN_ENTRIES = 1284;
