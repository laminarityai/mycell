// Pausing a workflow after its runs failed (M8): runtime counts the failures, since workflows
// can't read runs, and asks for the pause with the three runs; workflows stores it, for every
// enablement and the org switch alike (`readHolds`), until an admin resumes it. Nothing counts
// failures here: the count is worked out from the runs each time, so it can't drift.
import { and, eq, isNull } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { type Ctx, requireAdmin, requireSystem } from "@/lib/ctx";
import type { FailurePause } from "../types";
import { findWorkflow } from "./access";
import { latestVersions } from "./latest-versions";
import { workflows } from "./schema";

/**
 * When the workflow's runs' failures start counting: its last resume or its latest version's
 * publishing, whichever is later. Null when there's nothing to count: it's paused already, or
 * not published. Read by the run job, as the system ctx.
 */
export async function failureStreakStart(ctx: Ctx, workflowId: string): Promise<Date | null> {
  requireSystem(ctx);
  const [workflow, latest] = await Promise.all([
    findWorkflow(ctx, workflowId),
    latestVersions(ctx, [workflowId]),
  ]);
  const published = latest.get(workflowId)?.publishedAt;
  if (workflow.pausedReason !== null || published === undefined) return null;
  const resumed = workflow.resumedAt;
  return resumed !== null && resumed > published ? resumed : published;
}

/**
 * Pauses the workflow for its runs' failures, with the runs that paused it, newest first. A
 * workflow already paused keeps its pause as it was. For the run job, as the system ctx.
 */
export async function pauseForFailures(
  ctx: Ctx,
  workflowId: string,
  runIds: readonly string[],
): Promise<void> {
  requireSystem(ctx);
  await forOrg(ctx).update(
    workflows,
    { pausedReason: "failures", pausedAt: new Date(), pausedByRunIds: [...runIds] },
    and(eq(workflows.id, workflowId), isNull(workflows.pausedReason)),
  );
}

/**
 * Lifts a failure pause: new messages start runs again for every switch of it, and its runs'
 * failures count from now. Admins only; a workflow that isn't paused is left as it is.
 */
export async function resumeWorkflow(ctx: Ctx, workflowId: string): Promise<void> {
  requireAdmin(ctx);
  const workflow = await findWorkflow(ctx, workflowId);
  if (workflow.pausedReason === null) return;
  await forOrg(ctx).update(
    workflows,
    { pausedReason: null, pausedAt: null, pausedByRunIds: null, resumedAt: new Date() },
    eq(workflows.id, workflowId),
  );
}

/** A workflow row's failure pause, or null while its runs' failures don't pause it. */
export function failurePauseOf(row: {
  pausedAt: Date | null;
  pausedByRunIds: string[] | null;
}): FailurePause | null {
  if (row.pausedAt === null || row.pausedByRunIds === null) return null;
  return { pausedAt: row.pausedAt, runIds: row.pausedByRunIds };
}
