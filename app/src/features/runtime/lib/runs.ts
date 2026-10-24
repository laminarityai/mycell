// Run records: starting a run by hand, and reading a run's rows back. The manual start is
// admin-only (a retry is retries.ts's); the interpreter writes as the system ctx (interpreter.ts). What a person may read
// of a run is run-details.ts's and run-list.ts's business.
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { getConnection } from "@/features/connections/server";
import { getWorkflow, getWorkflowVersion } from "@/features/workflows/server";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import { ValidationError } from "@/lib/errors";
import { sendRunRequested } from "./events";
import { runs, runSteps } from "./schema";

type Run = typeof runs.$inferSelect;
type RunStepRow = typeof runSteps.$inferSelect;

/**
 * Runs the workflow's latest version on one message of a connection, or one calendar event
 * when its trigger is a new invite, as a debugging aid: the manual twin of the trigger. The connection must suit the spec's credentials (the admin's own
 * member connection, or an org connection) and be the admin's to read.
 */
export async function startRun(
  ctx: Ctx,
  workflowId: string,
  connectionId: string,
  sourceRef: string,
): Promise<{ runId: string }> {
  requireAdmin(ctx);
  const messageId = sourceRef.trim();
  if (messageId === "") {
    throw new ValidationError("Give the ID of a Gmail message, or of a calendar event.");
  }
  const workflow = await getWorkflow(ctx, workflowId);
  const latest = workflow.versions.at(0);
  if (latest === undefined) throw new ValidationError("Publish the workflow before running it.");
  const version = await getWorkflowVersion(ctx, latest.id);
  const connection = await getConnection(ctx, connectionId);
  if (connection.kind !== version.spec.credentials) {
    throw new ValidationError(
      version.spec.credentials === "member"
        ? "This workflow runs on your own connection, not an org connection."
        : "This workflow runs on an org connection.",
    );
  }
  const runId = randomUUID();
  await forOrg(ctx).insert(runs, {
    id: runId,
    connectionId,
    ownerScope: connection.kind,
    workflowId,
    workflowVersionId: version.id,
    sourceRef: messageId,
    status: "running",
  });
  await sendRunRequested({ orgId: ctx.orgId, runId, connectionId });
  return { runId };
}

export async function findRun(ctx: Ctx, runId: string): Promise<Run | undefined> {
  return (await forOrg(ctx).select(runs, { where: eq(runs.id, runId), limit: 1 })).at(0);
}

/** The run that retries this one, if it was retried. */
export async function findRetry(ctx: Ctx, runId: string): Promise<Run | undefined> {
  return (await forOrg(ctx).select(runs, { where: eq(runs.retryOfRunId, runId), limit: 1 })).at(0);
}

/** The run's recorded steps, in spec order. */
export async function stepsOf(ctx: Ctx, runIds: string[]): Promise<RunStepRow[]> {
  if (runIds.length === 0) return [];
  return forOrg(ctx).select(runSteps, {
    where: inArray(runSteps.runId, runIds),
    orderBy: [runSteps.position],
  });
}
