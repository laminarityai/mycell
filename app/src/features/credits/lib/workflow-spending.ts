// What a workflow's monthly budget counts (M7): the credits its live runs used this calendar
// month (UTC). Try it, builder chats and memory never count. Worked out from the ledger whenever
// it's asked, so a new month, or a budget raised or removed, lifts a budget pause with no job.
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { type Ctx, requireRole } from "@/lib/ctx";
import { monthRange } from "../types";
import { creditLedger } from "./schema";
import { utcDay } from "./spending";

/** The start of this calendar month, UTC: when this month's budgets began. */
export function monthStart(now = new Date()): Date {
  return monthRange(now).from;
}

/** The start of the next calendar month, UTC: when a budget pause ends by itself. */
export function nextMonthStart(now = new Date()): Date {
  return monthRange(now).to;
}

/**
 * The credits each of `workflowIds` has used in live runs this calendar month (UTC), by workflow
 * ID, 0 for one that used none. One query however many there are. Admins (and jobs) only: members
 * don't see what the company spends.
 */
export async function spentThisMonthByWorkflow(
  ctx: Ctx,
  workflowIds: readonly string[],
): Promise<Map<string, number>> {
  requireRole(ctx, "admin", "system");
  return spentThisMonth(ctx, workflowIds);
}

/**
 * Which of `budgets`' workflows (monthly credits, by workflow ID) have used their budget or more
 * in live runs this calendar month (UTC). Any role may ask: it says only what a member is shown,
 * that the workflow is paused, budget reached. One query, or none when no workflow has a budget.
 */
export async function budgetsReached(
  ctx: Ctx,
  budgets: ReadonlyMap<string, number>,
): Promise<Set<string>> {
  const spent = await spentThisMonth(ctx, [...budgets.keys()]);
  return new Set(
    [...budgets].flatMap(([workflowId, budget]) =>
      (spent.get(workflowId) ?? 0) >= budget ? [workflowId] : [],
    ),
  );
}

/**
 * Which of `budgets`' workflows (monthly credits, by workflow ID) have used their budget or more
 * in live runs this calendar month (UTC), as `budgetsReached` says, each with the UTC day its
 * running total this month reached the budget: since when it has been paused, for admins'
 * alerts. Admins (and jobs) only, since it says when the company spent. One query, grouped by
 * workflow and day, or none when no workflow has a budget.
 */
export async function budgetsReachedOn(
  ctx: Ctx,
  budgets: ReadonlyMap<string, number>,
): Promise<Map<string, Date>> {
  requireRole(ctx, "admin", "system");
  if (budgets.size === 0) return new Map();
  const daily = await forOrg(ctx).sumBy(
    creditLedger,
    creditLedger.amount,
    { workflowId: creditLedger.workflowId, day: utcDay },
    liveRunUsageThisMonth([...budgets.keys()]),
  );
  const totals = new Map<string, number>();
  const reached = new Map<string, Date>();
  // Day by day, as "2026-10-23" sorts: the first day each running total is at its budget.
  for (const { workflowId, day, total } of daily.sort((a, b) => a.day.localeCompare(b.day))) {
    const budget = workflowId === null ? undefined : budgets.get(workflowId);
    if (workflowId === null || budget === undefined || reached.has(workflowId)) continue;
    // Usage is negative.
    const spent = (totals.get(workflowId) ?? 0) - total;
    totals.set(workflowId, spent);
    if (spent >= budget) reached.set(workflowId, new Date(`${day}T00:00:00Z`));
  }
  return reached;
}

/** Usage entries the workflows' live runs made this calendar month (UTC), not Try it's. */
function liveRunUsageThisMonth(workflowIds: string[]) {
  return and(
    eq(creditLedger.kind, "usage"),
    inArray(creditLedger.workflowId, workflowIds),
    // A live run's usage: one a run made, not Try it's.
    isNotNull(creditLedger.runId),
    eq(creditLedger.dryRun, false),
    gte(creditLedger.createdAt, monthStart()),
  );
}

async function spentThisMonth(
  ctx: Ctx,
  workflowIds: readonly string[],
): Promise<Map<string, number>> {
  if (workflowIds.length === 0) return new Map();
  const totals = await forOrg(ctx).sumBy(
    creditLedger,
    creditLedger.amount,
    { workflowId: creditLedger.workflowId },
    liveRunUsageThisMonth([...workflowIds]),
  );
  // Usage is negative; `|| 0` turns no spending's -0 into 0.
  const byWorkflow = new Map(totals.map((row) => [row.workflowId, -row.total || 0]));
  return new Map(workflowIds.map((id) => [id, byWorkflow.get(id) ?? 0]));
}
