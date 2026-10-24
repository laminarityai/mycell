// Retrying a failed run: whoever reads its connection (the member who owns it, or an admin for
// an org connection) starts a new run of the workflow's latest version on the same message,
// linked to the run it retries. An admin never acts in a colleague's inbox (ADR-0001). A run is
// retried at most once: asked again while its retry is running, it asks for that retry again,
// as the trigger's fan-out does, so a lost request or a second click starts nothing twice.
import { randomUUID } from "node:crypto";
import { forOrg } from "@/db/for-org";
import { getConnection } from "@/features/connections/server";
import type { ConnectionOwnership } from "@/features/connections/types";
import { startableVersion } from "@/features/workflows/server";
import { isAdmin, type Ctx } from "@/lib/ctx";
import {
  ConflictError,
  ForbiddenError,
  InvariantError,
  NotFoundError,
  typedErrorMessage,
  ValidationError,
} from "@/lib/errors";
import type { RetryCheck } from "../types";
import { sendRunRequested } from "./events";
import { visibleRuns } from "./run-list";
import { findRetry, findRun } from "./runs";
import { runs } from "./schema";

type Run = typeof runs.$inferSelect;

const RETRIED = "This run was retried already.";

/**
 * Retries a failed or partly failed run on the same message, with the workflow's latest version,
 * and asks for the retry to execute. Refused with ForbiddenError unless the caller reads the
 * run's connection; ConflictError for a run that didn't fail or was retried already, and while
 * the workflow is archived or paused; OutOfCreditsError while the company is out of credits.
 */
export async function retryRun(ctx: Ctx, runId: string): Promise<{ runId: string }> {
  const { run, retry } = await failedRun(ctx, runId);
  if (retry !== undefined) return requestAgain(ctx, retry);
  const { versionId, ownerScope } = await startable(ctx, run);
  const created = await forOrg(ctx).insert(
    runs,
    {
      id: randomUUID(),
      connectionId: run.connectionId,
      ownerScope,
      workflowId: run.workflowId,
      workflowVersionId: versionId,
      startedBy: "retry",
      retryOfRunId: run.id,
      sourceRef: run.sourceRef,
      status: "running",
    },
    // Another request retried it meanwhile: that retry is the one.
    { onConflictDoNothing: true },
  );
  const started = created.at(0);
  if (started === undefined) {
    const other = await findRetry(ctx, run.id);
    if (other === undefined) throw new InvariantError("A retry conflicted with no other retry.");
    return requestAgain(ctx, other);
  }
  await sendRunRequested({ orgId: ctx.orgId, runId: started.id, connectionId: run.connectionId });
  return { runId: started.id };
}

/**
 * Whether the caller may retry the run now, and why not when they may not, in the words
 * `retryRun` would refuse with: for the run page's Retry button. NotFoundError for a run not in
 * the org.
 */
export async function checkRetry(ctx: Ctx, runId: string): Promise<RetryCheck> {
  try {
    const { run, retry } = await failedRun(ctx, runId);
    if (retry !== undefined) throw new ConflictError(RETRIED);
    await startable(ctx, run);
    return { allowed: true };
  } catch (error) {
    const why = error instanceof NotFoundError ? undefined : typedErrorMessage(error);
    if (why === undefined) throw error;
    return { allowed: false, why };
  }
}

// The run, if the caller reads its connection and it failed, with its retry if it has one.
async function failedRun(ctx: Ctx, runId: string): Promise<{ run: Run; retry: Run | undefined }> {
  const [{ owners }, run] = await Promise.all([visibleRuns(ctx), findRun(ctx, runId)]);
  if (run === undefined) throw new NotFoundError("run");
  const owner = owners.get(run.connectionId);
  if (owner?.readable !== true) throw notTheirs(ctx, owner);
  if (run.status !== "failed" && run.status !== "partly_failed") {
    throw new ConflictError("Only a failed run can be retried.");
  }
  return { run, retry: await findRetry(ctx, run.id) };
}

// An admin sees a colleague's run, but only its owner may act in their inbox; a member doesn't
// see anyone else's.
function notTheirs(ctx: Ctx, owner: ConnectionOwnership | undefined): ForbiddenError {
  if (!isAdmin(ctx) || owner === undefined) return new ForbiddenError();
  const who = owner.owner.removed ? "the inbox's owner" : owner.owner.name;
  return new ForbiddenError(`Only ${who} can retry a run on their own inbox.`);
}

// What the retry would run, if it may start now: the workflow's latest version, on a connection
// it still suits and Google still accepts.
async function startable(
  ctx: Ctx,
  run: Run,
): Promise<{ versionId: string; ownerScope: Run["ownerScope"] }> {
  const [version, connection] = await Promise.all([
    startableVersion(ctx, run.workflowId, run.connectionId),
    getConnection(ctx, run.connectionId),
  ]);
  if (connection.kind !== version.spec.credentials) {
    throw new ValidationError(
      version.spec.credentials === "member"
        ? "The workflow now runs on each member's own inbox, not on this one."
        : "The workflow now runs on an org connection, not on this inbox.",
    );
  }
  if (connection.needsReauth) {
    throw new ConflictError("Google refused this inbox's access. Reconnect Google first.");
  }
  return { versionId: version.id, ownerScope: connection.kind };
}

// The retry already started: asked for again while it runs, in case the first request was lost
// (its event ID makes Inngest execute it once).
async function requestAgain(ctx: Ctx, retry: Run): Promise<{ runId: string }> {
  if (retry.status !== "running") throw new ConflictError(RETRIED);
  await sendRunRequested({ orgId: ctx.orgId, runId: retry.id, connectionId: retry.connectionId });
  return { runId: retry.id };
}
