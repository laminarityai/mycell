// The org's workflows that a pause of their own holds over (M8), for admins' alerts: paused for
// their runs' failures, as stored on the workflow, and at their latest version's budget this
// month, from the ledger, the same rule `readHolds` applies at fan-out. Out of credits holds
// over every workflow, so it's the company's alert, not each workflow's. An archived workflow
// stops everywhere anyway and isn't listed.
import { isNull } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { budgetsReachedOn } from "@/features/credits/server";
import { type Ctx, requireAdmin } from "@/lib/ctx";
import type { PausedWorkflow } from "../types";
import { failurePauseOf } from "./failure-pauses";
import { latestVersions } from "./latest-versions";
import { workflows } from "./schema";

/**
 * Every unarchived workflow paused for failing or at its budget, by name. Admins only. Three
 * queries however many workflows there are: the workflows, their latest versions (for their
 * budgets) and the budgeted ones' spending this month.
 */
export async function listPausedWorkflows(ctx: Ctx): Promise<PausedWorkflow[]> {
  requireAdmin(ctx);
  const rows = await forOrg(ctx).select(workflows, {
    columns: ["id", "name", "pausedAt", "pausedByRunIds"],
    where: isNull(workflows.archivedAt),
    orderBy: [workflows.name],
  });
  const latest = await latestVersions(
    ctx,
    rows.map((row) => row.id),
  );
  const budgets = new Map(
    [...latest].flatMap(([workflowId, version]) => {
      const budget = version.spec.budget?.monthlyCredits;
      return budget === undefined ? [] : [[workflowId, budget] as const];
    }),
  );
  const reached = await budgetsReachedOn(ctx, budgets);
  return rows.flatMap((row) => {
    const failurePause = failurePauseOf(row);
    const reachedOn = reached.get(row.id);
    const monthlyCredits = budgets.get(row.id);
    const budgetReached =
      reachedOn === undefined || monthlyCredits === undefined
        ? null
        : { monthlyCredits, reachedOn };
    if (failurePause === null && budgetReached === null) return [];
    return [{ id: row.id, name: row.name, failurePause, budgetReached }];
  });
}
