// The caller's own enablement of a workflow, when a run they ask for by name would start now:
// Ask Mycel's runs (`runtime`'s startRunFromAgent). It's refused whenever the trigger's fan-out
// (startable.ts) wouldn't start one for them: a workflow they can't see, one that's archived or
// runs on an org connection, one they haven't switched on, or any pause that holds on it.
import { and, eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { listMyTags } from "@/features/tags/server";
import { isAdmin, requireRole, type Ctx } from "@/lib/ctx";
import { ConflictError, NotFoundError, OutOfCreditsError, ValidationError } from "@/lib/errors";
import type { PausedReason, StartableEnablement } from "../types";
import { findWorkflow } from "./access";
import { latestVersions } from "./latest-versions";
import { pausedText } from "./paused-text";
import { pausesOf, readHolds } from "./pauses";
import { enablements } from "./schema";
import { tagIdsOf } from "./visibility";

/**
 * The caller's enablement of the workflow, with the latest version it would run. Refused with
 * the reason in words: NotFoundError for a workflow they can't see, ValidationError for one never
 * published or on an org connection, ConflictError while it's archived, while they haven't
 * switched it on and while it's paused for them, OutOfCreditsError while the company is out of
 * credits. People only; the system ctx is ForbiddenError.
 */
export async function startableEnablement(
  ctx: Ctx,
  workflowId: string,
): Promise<StartableEnablement> {
  requireRole(ctx, "admin", "member");
  const [workflow, latest] = await Promise.all([
    findWorkflow(ctx, workflowId),
    latestVersions(ctx, [workflowId]),
  ]);
  const version = latest.get(workflowId);
  const admin = isAdmin(ctx);
  // A member sees only a published workflow that isn't archived, through one of their tags.
  if (
    !admin &&
    (version === undefined || workflow.archivedAt !== null || !(await sees(ctx, version.id)))
  ) {
    throw new NotFoundError("workflow");
  }
  const { name } = workflow;
  if (version === undefined) throw new ValidationError(`${name} isn't published yet.`);
  if (workflow.archivedAt !== null) throw new ConflictError(`${name} is archived.`);
  if (version.spec.credentials === "org") {
    throw new ValidationError(
      `${name} runs on a shared inbox, not on your own mail, so Ask Mycel can't run it.`,
    );
  }
  const [own, holds] = await Promise.all([
    forOrg(ctx).select(enablements, {
      where: and(eq(enablements.workflowId, workflowId), eq(enablements.userId, ctx.userId)),
      limit: 1,
    }),
    readHolds(ctx, [workflowId]),
  ]);
  const enablement = own.at(0);
  if (enablement === undefined) {
    throw new ConflictError(`You haven't switched ${name} on. Switch it on from Workflows first.`);
  }
  const pause = pausesOf(enablement, holds(workflowId)).at(0);
  if (pause === "out_of_credits") throw new OutOfCreditsError();
  if (pause !== undefined) {
    const why = pausedText(pause, enablement.pausedChange);
    throw new ConflictError(`${name} is paused: ${why}. ${LIFT_FIRST[pause]}`);
  }
  return {
    workflowId,
    name,
    versionId: version.id,
    enablementId: enablement.id,
    connectionId: enablement.connectionId,
  };
}

// What to do before running it, for each pause but running out of credits.
const LIFT_FIRST: Record<Exclude<PausedReason, "out_of_credits">, string> = {
  needs_reenable: "Switch it on again first.",
};

// Whether the version was published to one of the caller's tags.
async function sees(ctx: Ctx, versionId: string): Promise<boolean> {
  const [mine, tagIds] = await Promise.all([listMyTags(ctx), tagIdsOf(ctx, [versionId])]);
  const theirs = new Set(mine.map((tag) => tag.id));
  return (tagIds.get(versionId) ?? []).some((tagId) => theirs.has(tagId));
}
