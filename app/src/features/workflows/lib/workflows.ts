// Saving and reading workflows. Admin-only in M3: members get ForbiddenError for every one.
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { isUniqueViolation } from "@/db/errors";
import { forOrg } from "@/db/for-org";
import { applyPolicy } from "@/features/policy/engine";
import type { Ctx } from "@/lib/ctx";
import { ConflictError, ValidationError } from "@/lib/errors";
import type {
  SavedWorkflow,
  WorkflowDetails,
  WorkflowInput,
  WorkflowSummary,
  WorkflowVersionSummary,
} from "../types";
import { findWorkflow, requireAdmin } from "./access";
import { workflows, workflowVersions } from "./schema";
import { switchesOf, switchOf } from "./switches";
import { validateWorkflowSpec } from "./validation";

type Version = typeof workflowVersions.$inferSelect;

/**
 * Validates the spec in full and saves it as a workflow's working spec: a new workflow when
 * `workflowId` is left out. A spec that fails isn't saved; SpecInvalidError carries every issue.
 * Publishing is separate, so saving never changes what runs.
 */
export async function saveWorkflow(ctx: Ctx, input: WorkflowInput): Promise<SavedWorkflow> {
  requireAdmin(ctx);
  const name = input.name.trim();
  if (name === "") throw new ValidationError("Give the workflow a name.");
  if (input.workflowId !== undefined) await findWorkflow(ctx, input.workflowId);
  const validated = await validateWorkflowSpec(ctx, input.spec);

  const values = { name, specId: validated.working.id, workingSpec: validated.working };
  const db = forOrg(ctx);
  try {
    if (input.workflowId === undefined) {
      const id = randomUUID();
      await db.insert(workflows, { ...values, id, createdBy: ctx.userId });
      return { id, maxRisk: validated.maxRisk, inserted: validated.inserted };
    }
    await db.update(
      workflows,
      { ...values, updatedAt: new Date() },
      eq(workflows.id, input.workflowId),
    );
    return { id: input.workflowId, maxRisk: validated.maxRisk, inserted: validated.inserted };
  } catch (error) {
    if (isUniqueViolation(error, "workflows_org_id_spec_id_unique")) {
      throw new ConflictError(`Another workflow already has the spec ID "${values.specId}".`);
    }
    throw error;
  }
}

/** The org's workflows by name, each with its latest version and its switch. */
export async function listWorkflows(ctx: Ctx): Promise<WorkflowSummary[]> {
  requireAdmin(ctx);
  const db = forOrg(ctx);
  const rows = await db.select(workflows, { orderBy: [workflows.name] });
  const versions = await db.select(workflowVersions, { orderBy: [desc(workflowVersions.number)] });
  const latest = new Map<string, Version>();
  for (const version of versions) {
    if (!latest.has(version.workflowId)) latest.set(version.workflowId, version);
  }
  const switches = await switchesOf(ctx, rows);
  return rows.map((row) => {
    const version = latest.get(row.id);
    return {
      id: row.id,
      name: row.name,
      specId: row.specId,
      latestVersion: version === undefined ? null : versionSummary(version),
      switch: switches.get(row.id) ?? null,
      updatedAt: row.updatedAt,
    };
  });
}

/** One workflow, with what the policy engine makes of its working spec and its versions. */
export async function getWorkflow(ctx: Ctx, workflowId: string): Promise<WorkflowDetails> {
  requireAdmin(ctx);
  const row = await findWorkflow(ctx, workflowId);
  const versions = await forOrg(ctx).select(workflowVersions, {
    where: eq(workflowVersions.workflowId, workflowId),
    orderBy: [desc(workflowVersions.number)],
  });
  const policy = applyPolicy(row.workingSpec);
  return {
    id: row.id,
    name: row.name,
    specId: row.specId,
    workingSpec: row.workingSpec,
    maxRisk: policy.ok ? policy.maxRisk : null,
    inserted: policy.ok ? policy.inserted : [],
    versions: versions.map(versionSummary),
    switch: await switchOf(ctx, row),
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
  };
}

export function versionSummary(version: Version): WorkflowVersionSummary {
  return {
    id: version.id,
    number: version.number,
    maxRisk: version.maxRisk,
    publishedBy: version.publishedBy,
    publishedAt: version.publishedAt,
  };
}
