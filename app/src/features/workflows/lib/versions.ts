// Publishing: a workflow's working spec, validated again, becomes its next immutable version.
// There is no update path for a version.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { isUniqueViolation } from "@/db/errors";
import { forOrg } from "@/db/for-org";
import { sameValue } from "@/features/spec/diff";
import type { Spec } from "@/features/spec/types";
import { findTagsByName } from "@/features/tags/server";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import type { PublishSettings, WorkflowVersion } from "../types";
import { workflows, workflowVersions, workflowVersionTags } from "./schema";
import { validateWorkflowSpec } from "./validation";
import { findWorkflow } from "./access";
import { gainedForEnablements, pauseEnablements } from "./version-pauses";
import { latestVersions, version } from "./latest-versions";
import { removeInvisibleIn } from "./lost-visibility";

/**
 * Re-validates the working spec (connections may have changed since it was saved) and records
 * it, after the policy engine, as the workflow's next version, published to the tags its
 * `visibility.tags` names. A name no tag in the org has is refused with ValidationError.
 * `settings` are what the publish dialog chose: they're saved into the working spec first, in
 * the same transaction, so the working spec and the version agree. Enablements follow the new
 * version, unless it needs more than the latest one did: then, in the same transaction, each
 * one that's on pauses until its member enables it again (version-pauses.ts). Members its tags
 * no longer reach lose their enablements in that transaction too (lost-visibility.ts).
 */
export async function publishWorkflow(
  ctx: Ctx,
  workflowId: string,
  settings: PublishSettings = {},
): Promise<WorkflowVersion> {
  requireAdmin(ctx);
  const workflow = await findWorkflow(ctx, workflowId);
  const working = withSettings(workflow.workingSpec, settings);
  const validated = await validateWorkflowSpec(ctx, working);
  // Names no tag in the org has are refused here, before anything is written.
  const tags = await findTagsByName(ctx, validated.applied.visibility?.tags ?? []);
  const db = forOrg(ctx);
  const latest = (await latestVersions(ctx, [workflowId], db)).get(workflowId);
  const gained = gainedForEnablements(latest, validated);
  try {
    // The version, its tags, the removals and the pauses together: a version is never seen
    // without who it's for, nor runs for anyone who can't see it or hasn't agreed to it.
    const row = await db.transaction(async (tx) => {
      if (!sameValue(working, workflow.workingSpec)) {
        // Only over the working spec this read: a save in between is never overwritten.
        const saved = await tx.update(
          workflows,
          {
            workingSpec: validated.working,
            revision: workflow.revision + 1,
            updatedAt: new Date(),
          },
          and(eq(workflows.id, workflowId), eq(workflows.revision, workflow.revision)),
        );
        if (saved.length === 0) {
          throw new ConflictError(
            "The working spec was saved again since you opened it, so nothing was published. Reload to see the current one.",
          );
        }
      }
      const inserted = (
        await tx.insert(workflowVersions, {
          id: randomUUID(),
          workflowId,
          number: (latest?.number ?? 0) + 1,
          spec: validated.applied,
          maxRisk: validated.maxRisk,
          requiredActions: validated.requiredActions,
          publishedBy: ctx.userId,
        })
      ).at(0);
      // An insert returns its row, so this is a bug, not something a user can act on: it's
      // left a plain Error for the action boundary to rethrow (src/lib/errors.ts, actionError).
      if (inserted === undefined) throw new Error("insert returned no version");
      await tx.insert(
        workflowVersionTags,
        tags.map((tag) => ({ workflowVersionId: inserted.id, tagId: tag.id })),
      );
      // Members the new tags leave out lose their enablements, before anything is paused.
      await removeInvisibleIn(ctx, tx, { workflowId });
      if (gained !== null) await pauseEnablements(tx, workflowId, gained);
      return inserted;
    });
    return version(row);
  } catch (error) {
    if (isUniqueViolation(error, "workflow_versions_workflow_id_number_unique")) {
      throw new ConflictError("Someone else published this workflow just now. Try again.");
    }
    throw error;
  }
}

// The working spec with the publish dialog's choices in it.
function withSettings(spec: Spec, settings: PublishSettings): Spec {
  const { tags, handoff } = settings;
  return {
    ...spec,
    ...(tags === undefined ? {} : { visibility: { tags: [...tags] } }),
    ...(handoff === undefined ? {} : { review: { handoff } }),
  };
}

/** One published version, for an admin or for a run acting as the system ctx (ADR-0009). */
export async function getWorkflowVersion(ctx: Ctx, versionId: string): Promise<WorkflowVersion> {
  if (ctx.role !== "admin" && ctx.role !== "system") throw new ForbiddenError();
  const rows = await forOrg(ctx).select(workflowVersions, {
    where: eq(workflowVersions.id, versionId),
    limit: 1,
  });
  const row = rows.at(0);
  if (row === undefined) throw new NotFoundError("workflow version");
  return version(row);
}
