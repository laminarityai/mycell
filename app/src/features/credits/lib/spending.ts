// What the Credits page shows (M7): a range's spending by kind of use, by workflow and by day,
// and how long the balance lasts. Every sum is the database's: a range is one grouped sum and
// the balance before it, whatever the number of workflows, entries or days.
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { type Ctx, requireRole } from "@/lib/ctx";
import {
  DAY_MS,
  daysOf,
  type DailySpending,
  monthRange,
  type Runway,
  type SpendingByKind,
  type SpendingRange,
  type SpendingSummary,
  spendingKindOf,
  type WorkflowSpending,
} from "../types";
import { getBalance, inRange } from "./ledger";
import { creditLedger } from "./schema";

// An entry's UTC day, as "2026-10-23": what a range's spending is grouped by.
const utcDay = sql<string>`to_char(${creditLedger.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;

// Whether a run made the usage. Grouped by this rather than by run, so a busy workflow's month
// is still a group a day.
const madeByRun = sql<boolean>`${creditLedger.runId} is not null`;

const noSpending = (): SpendingByKind => ({ workflow: 0, memory: 0, builder: 0, try_it: 0 });

const dayKey = (day: Date) => day.toISOString().slice(0, 10);

/**
 * The range's spending by kind of use, by workflow and by day, what was granted, and the
 * balance as it began. A workflow's spending is its live runs': Try it and builder turns about
 * it are their own kinds. Its month's spending before a range that starts after the 1st comes
 * back too, since budgets are monthly: the grouped sum starts on that 1st. Admins (and jobs)
 * only.
 */
export async function getSpendingSummary(ctx: Ctx, range: SpendingRange): Promise<SpendingSummary> {
  requireRole(ctx, "admin", "system");
  const db = forOrg(ctx);
  const monthStart = monthRange(range.from).from;
  const [groups, openingBalance] = await Promise.all([
    db.sumBy(
      creditLedger,
      creditLedger.amount,
      {
        day: utcDay,
        kind: creditLedger.kind,
        dryRun: creditLedger.dryRun,
        purpose: creditLedger.purpose,
        workflowId: creditLedger.workflowId,
        madeByRun,
      },
      inRange({ from: monthStart, to: range.to }),
    ),
    db.sum(creditLedger, creditLedger.amount, lt(creditLedger.createdAt, range.from)),
  ]);

  const days: DailySpending[] = daysOf(range).map((day) => ({
    day,
    byKind: noSpending(),
    spent: 0,
    granted: 0,
  }));
  const dayIndex = new Map(days.map((day, i) => [dayKey(day.day), i]));
  const summary = { spent: 0, granted: 0, byKind: noSpending() };
  const workflows = new Map<string, WorkflowSpending>();
  const workflow = (workflowId: string) => {
    const found = workflows.get(workflowId);
    if (found !== undefined) return found;
    const added = { workflowId, spent: 0, daily: days.map(() => 0), monthBefore: 0 };
    workflows.set(workflowId, added);
    return added;
  };
  for (const group of groups) {
    // Usage is negative in the ledger.
    const credits = -group.total || 0;
    // A stand-in run ID: the kind asks only whether a run made it.
    const kind =
      group.kind === "grant"
        ? null
        : spendingKindOf({ ...group, runId: group.madeByRun ? "run" : null });
    const i = dayIndex.get(group.day);
    const day = i === undefined ? undefined : days[i];
    if (i === undefined || day === undefined) {
      // Before the range, in its first month: only where a workflow's month starts.
      if (kind === "workflow" && group.workflowId !== null) {
        workflow(group.workflowId).monthBefore += credits;
      }
      continue;
    }
    if (group.kind === "grant") {
      day.granted += group.total;
      summary.granted += group.total;
      continue;
    }
    day.spent += credits;
    summary.spent += credits;
    if (kind === null) continue;
    day.byKind[kind] += credits;
    summary.byKind[kind] += credits;
    if (kind !== "workflow" || group.workflowId === null) continue;
    const line = workflow(group.workflowId);
    line.spent += credits;
    line.daily[i] = (line.daily[i] ?? 0) + credits;
  }

  return {
    range,
    openingBalance,
    ...summary,
    byWorkflow: [...workflows.values()].sort(
      (a, b) => b.spent - a.spent || b.monthBefore - a.monthBefore,
    ),
    days,
  };
}

/**
 * When the org's first ledger entry was made, where its history starts (the Credits page keeps
 * a range from reaching before it); null before any. Admins (and jobs) only.
 */
export async function getLedgerStart(ctx: Ctx): Promise<Date | null> {
  requireRole(ctx, "admin", "system");
  const first = await forOrg(ctx).select(creditLedger, {
    columns: ["createdAt"],
    orderBy: [asc(creditLedger.createdAt)],
    limit: 1,
  });
  return first.at(0)?.createdAt ?? null;
}

/**
 * How long the balance lasts at the last 7 days' average daily usage; no runway when nothing
 * was used in them. Admins (and jobs) only.
 */
export async function getRunway(ctx: Ctx): Promise<Runway> {
  requireRole(ctx, "admin", "system");
  const now = Date.now();
  const [balance, used] = await Promise.all([
    getBalance(ctx),
    forOrg(ctx).sum(
      creditLedger,
      creditLedger.amount,
      and(eq(creditLedger.kind, "usage"), gte(creditLedger.createdAt, new Date(now - 7 * DAY_MS))),
    ),
  ]);
  const lastWeek = -used;
  if (lastWeek <= 0) return { balance, dailyRate: null, days: null, zeroAt: null };
  const dailyRate = lastWeek / 7;
  const days = Math.max(0, balance / dailyRate);
  return { balance, dailyRate, days, zeroAt: new Date(now + days * DAY_MS) };
}
