// The version a run started by hand on one connection would run now (a retry, `runtime`'s
// retryRun): the workflow's latest, while the caller sees it, it isn't archived and nothing
// pauses it there. The pauses are the trigger's fan-out's (startable.ts): what holds over the
// workflow, and the caller's own enablement's on that connection, if they have one.
import { and, eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { listMyTags } from "@/features/tags/server";
import { isAdmin, requireRole, type Ctx } from "@/lib/ctx";
import { ConflictError, ForbiddenError, OutOfCreditsError, ValidationError } from "@/lib/errors";
import type { PausedReason, WorkflowVersion } from "../types";
import { findWorkflow } from "./access";
import { latestVersions } from "./latest-versions";
import { pausedText } from "./paused-text";
import { pausesOf, readHolds } from "./pauses";
import { enablements } from "./schema";
import { tagIdsOf } from "./visibility";

/**
 * The workflow's latest version, for a run the caller starts by hand on `connectionId`. Refused
 * with the reason in words: ValidationError when it was never published, ConflictError while
 * it's archived or paused there, OutOfCreditsError while the company is out of credits, and
 * ForbiddenError for a member who no longer sees it. NotFoundError for a workflow not in the org.
 */
export async function startableVersion(
  ctx: Ctx,
  workflowId: string,
  connectionId: string,
): Promise<WorkflowVersion> {
  requireRole(ctx, "admin", "member");
  const [workflow, latest] = await Promise.all([
    findWorkflow(ctx, workflowId),
    latestVersions(ctx, [workflowId]),
  ]);
  const version = latest.get(workflowId);
  if (version === undefined) throw new ValidationError("Publish the workflow before running it.");
  if (workflow.archivedAt !== null) {
    throw new ConflictError(
      isAdmin(ctx)
        ? `${workflow.name} is archived. Restore it first.`
        : `${workflow.name} is archived.`,
    );
  }
  if (!isAdmin(ctx) && !(await seesVersion(ctx, version.id))) {
    throw new ForbiddenError(`${workflow.name} is no longer shared with you.`);
  }
  const [holds, own] = await Promise.all([
    readHolds(ctx, [workflowId]),
    forOrg(ctx).select(enablements, {
      where: and(
        eq(enablements.workflowId, workflowId),
        eq(enablements.userId, ctx.userId),
        eq(enablements.connectionId, connectionId),
      ),
      limit: 1,
    }),
  ]);
  const enablement = own.at(0) ?? null;
  const pause = pausesOf(enablement, holds(workflowId)).at(0);
  if (pause === "out_of_credits") throw new OutOfCreditsError();
  if (pause !== undefined) {
    const why = pausedText(pause, enablement?.pausedChange ?? null);
    throw new ConflictError(`${workflow.name} is paused: ${why}. ${LIFT_FIRST[pause]}`);
  }
  return version;
}

// What to do before starting it, for each pause but running out of credits.
const LIFT_FIRST: Record<Exclude<PausedReason, "out_of_credits">, string> = {
  needs_reenable: "Switch it on again first.",
  failures: "An admin has to resume it first.",
};

// Whether the version was published to one of the caller's tags.
async function seesVersion(ctx: Ctx, versionId: string): Promise<boolean> {
  const [mine, tagIds] = await Promise.all([listMyTags(ctx), tagIdsOf(ctx, [versionId])]);
  const theirs = new Set(mine.map((tag) => tag.id));
  return (tagIds.get(versionId) ?? []).some((tagId) => theirs.has(tagId));
}
