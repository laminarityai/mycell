// What a workflow's monthly budget counts (M7): the credits its live runs used this calendar
// month (UTC). Try it, builder chats and memory never count. Worked out from the ledger whenever
// it's asked, so a new month, or a budget raised or removed, lifts a budget pause with no job.
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { type Ctx, requireRole } from "@/lib/ctx";
import { creditLedger } from "./schema";

/** The start of this calendar month, UTC: when this month's budgets began. */
export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** The start of the next calendar month, UTC: when a budget pause ends by itself. */
export function nextMonthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
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

async function spentThisMonth(
  ctx: Ctx,
  workflowIds: readonly string[],
): Promise<Map<string, number>> {
  if (workflowIds.length === 0) return new Map();
  const totals = await forOrg(ctx).sumBy(
    creditLedger,
    creditLedger.amount,
    { workflowId: creditLedger.workflowId },
    and(
      eq(creditLedger.kind, "usage"),
      inArray(creditLedger.workflowId, [...workflowIds]),
      // A live run's usage: one a run made, not Try it's.
      isNotNull(creditLedger.runId),
      eq(creditLedger.dryRun, false),
      gte(creditLedger.createdAt, monthStart()),
    ),
  );
  // Usage is negative; `|| 0` turns no spending's -0 into 0.
  const byWorkflow = new Map(totals.map((row) => [row.workflowId, -row.total || 0]));
  return new Map(workflowIds.map((id) => [id, byWorkflow.get(id) ?? 0]));
}
