// Publishing: a workflow's working spec, validated again, becomes its next immutable version.
// There is no update path for a version.
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { isUniqueViolation } from "@/db/errors";
import { forOrg } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import type { WorkflowVersion } from "../types";
import { workflowVersions } from "./schema";
import { validateWorkflowSpec } from "./validation";
import { findWorkflow, requireAdmin } from "./access";

type Version = typeof workflowVersions.$inferSelect;

/**
 * Re-validates the working spec (connections may have changed since it was saved) and records
 * it, after the policy engine, as the workflow's next version.
 */
export async function publishWorkflow(ctx: Ctx, workflowId: string): Promise<WorkflowVersion> {
  requireAdmin(ctx);
  const workflow = await findWorkflow(ctx, workflowId);
  const validated = await validateWorkflowSpec(ctx, workflow.workingSpec);
  const db = forOrg(ctx);
  const latest = (
    await db.select(workflowVersions, {
      where: eq(workflowVersions.workflowId, workflowId),
      orderBy: [desc(workflowVersions.number)],
      limit: 1,
    })
  ).at(0);
  try {
    const row = (
      await db.insert(workflowVersions, {
        id: randomUUID(),
        workflowId,
        number: (latest?.number ?? 0) + 1,
        spec: validated.applied,
        maxRisk: validated.maxRisk,
        requiredActions: validated.requiredActions,
        publishedBy: ctx.userId,
      })
    ).at(0);
    // An insert returns its row, so this is a bug, not something a user can act on: it's left
    // a plain Error for the action boundary to rethrow (src/lib/errors.ts, actionError).
    if (row === undefined) throw new Error("insert returned no version");
    return version(row);
  } catch (error) {
    if (isUniqueViolation(error, "workflow_versions_workflow_id_number_unique")) {
      throw new ConflictError("Someone else published this workflow just now. Try again.");
    }
    throw error;
  }
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

function version(row: Version): WorkflowVersion {
  return {
    id: row.id,
    workflowId: row.workflowId,
    number: row.number,
    spec: row.spec,
    maxRisk: row.maxRisk,
    requiredActions: row.requiredActions,
    publishedBy: row.publishedBy,
    publishedAt: row.publishedAt,
  };
}
