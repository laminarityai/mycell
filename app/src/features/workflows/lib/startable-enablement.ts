// The caller's own enablement of a workflow, when a run they ask for by name would start now:
// Ask Mycel's runs (`runtime`'s startRunFromAgent). It's refused whenever the trigger's fan-out
// (startable.ts) wouldn't start one for them: a workflow they can't see, one that runs on an org
// connection, one they haven't switched on, and whatever `startableVersion` refuses on their
// enablement's connection (archived, no longer shared, every pause, out of credits included).
import { and, eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { requireRole, type Ctx } from "@/lib/ctx";
import { ConflictError, ValidationError } from "@/lib/errors";
import type { StartableEnablement } from "../types";
import { workflowNames } from "./names";
import { enablements } from "./schema";
import { startableVersion } from "./startable-version";
import { getVisibleWorkflow } from "./visibility";

/**
 * The caller's enablement of the workflow, with the latest version it would run. Refused with
 * the reason in words: NotFoundError for a workflow they can't see, ValidationError for one on
 * an org connection, ConflictError while they haven't switched it on, and `startableVersion`'s
 * refusals on their enablement's connection (archived, paused for any reason, out of credits).
 * People only; the system ctx is ForbiddenError.
 */
export async function startableEnablement(
  ctx: Ctx,
  workflowId: string,
): Promise<StartableEnablement> {
  requireRole(ctx, "admin", "member");
  const own = await forOrg(ctx).select(enablements, {
    columns: ["id", "connectionId"],
    where: and(eq(enablements.workflowId, workflowId), eq(enablements.userId, ctx.userId)),
    limit: 1,
  });
  const enablement = own.at(0);
  if (enablement === undefined) {
    // Why it isn't theirs to run: NotFoundError when they can't see it at all.
    const { name, credentials } = await getVisibleWorkflow(ctx, workflowId);
    if (credentials === "org") throw orgWorkflow(name);
    throw new ConflictError(`You haven't switched ${name} on. Switch it on from Workflows first.`);
  }
  const version = await startableVersion(ctx, workflowId, enablement.connectionId);
  const name = (await workflowNames(ctx, [workflowId])).get(workflowId) ?? "The workflow";
  // Republished for an org connection since they switched it on.
  if (version.spec.credentials === "org") throw orgWorkflow(name);
  return {
    workflowId,
    name,
    versionId: version.id,
    enablementId: enablement.id,
    connectionId: enablement.connectionId,
  };
}

const orgWorkflow = (name: string) =>
  new ValidationError(
    `${name} runs on a shared inbox, not on your own mail, so Ask Mycel can't run it.`,
  );
