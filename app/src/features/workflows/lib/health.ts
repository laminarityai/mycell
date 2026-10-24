// What the workflow page's Health tab checks (M7): whether the company has credits, whether the
// workflow's runs' failures paused it (M8), and what its live runs spent this calendar month
// (UTC) against its latest version's budget. The pauses are the ones `readHolds` works out for
// the fan-out, so the tab and what starts agree.
import { getBalance, nextMonthStart, spentThisMonthByWorkflow } from "@/features/credits/server";
import { type Ctx, requireAdmin } from "@/lib/ctx";
import type { WorkflowHealth } from "../types";
import { findWorkflow } from "./access";
import { failurePauseOf } from "./failure-pauses";
import { latestVersions } from "./latest-versions";
import { pausesOf, readHolds } from "./pauses";

/** The workflow's health, for its page. Admins only; NotFoundError outside the caller's org. */
export async function getWorkflowHealth(ctx: Ctx, workflowId: string): Promise<WorkflowHealth> {
  requireAdmin(ctx);
  const workflow = await findWorkflow(ctx, workflowId);
  const [latest, balance, spent, holds] = await Promise.all([
    latestVersions(ctx, [workflowId]),
    getBalance(ctx),
    spentThisMonthByWorkflow(ctx, [workflowId]),
    readHolds(ctx, [workflowId]),
  ]);
  const version = latest.get(workflowId);
  const pauses = pausesOf(null, holds(workflowId));
  return {
    workflowId,
    // Only a published workflow that isn't archived would run, so only it is paused.
    status:
      version === undefined
        ? "not_published"
        : workflow.archivedAt !== null
          ? "archived"
          : pauses.length > 0
            ? "paused"
            : "running",
    pauses: version === undefined || workflow.archivedAt !== null ? [] : pauses,
    balance,
    failurePause: failurePauseOf(workflow),
    spentThisMonth: spent.get(workflowId) ?? 0,
    monthlyBudget: version?.spec.budget?.monthlyCredits ?? null,
    nextMonth: nextMonthStart(),
  };
}
