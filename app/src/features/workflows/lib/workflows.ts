// Saving and reading workflows. Admin-only in M3: members get ForbiddenError for every one.
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { isUniqueViolation } from "@/db/errors";
import { forOrg } from "@/db/for-org";
import { applyPolicy } from "@/features/policy/engine";
import { sameValue } from "@/features/spec/diff";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import { ConflictError, ValidationError } from "@/lib/errors";
import type {
  SavedWorkflow,
  WorkflowDetails,
  WorkflowInput,
  WorkflowSummary,
  WorkflowVersionSummary,
} from "../types";
import { findWorkflow } from "./access";
import { workflows, workflowVersions } from "./schema";
import { switchesOf, switchOf } from "./switches";
import { validateWorkflowSpec } from "./validation";

type Version = typeof workflowVersions.$inferSelect;

/**
 * Validates the spec in full and saves it as a workflow's working spec: a new workflow when
 * `workflowId` is left out. A spec that fails isn't saved; SpecInvalidError carries every issue.
 * Publishing is separate, so saving never changes what runs. Each save moves the working spec's
 * revision on; with `baseRevision`, a save from a revision that has since moved on is refused
 * with ConflictError, never merged.
 */
export async function saveWorkflow(ctx: Ctx, input: WorkflowInput): Promise<SavedWorkflow> {
  requireAdmin(ctx);
  const name = input.name.trim();
  if (name === "") throw new ValidationError("Give the workflow a name.");
  const existing =
    input.workflowId === undefined ? undefined : await findWorkflow(ctx, input.workflowId);
  const validated = await validateWorkflowSpec(ctx, input.spec);

  const values = { name, specId: validated.working.id, workingSpec: validated.working };
  const db = forOrg(ctx);
  try {
    if (input.workflowId === undefined) {
      const id = randomUUID();
      await db.insert(workflows, { ...values, id, createdBy: ctx.userId });
      return { id, revision: 1, maxRisk: validated.maxRisk, inserted: validated.inserted };
    }
    const base = input.baseRevision ?? existing?.revision ?? 1;
    // One conditional update: it saves only while the working spec is still at `base`.
    const updated = await db.update(
      workflows,
      { ...values, revision: base + 1, updatedAt: new Date() },
      and(eq(workflows.id, input.workflowId), eq(workflows.revision, base)),
    );
    if (updated.length === 0) {
      throw new ConflictError(
        "The working spec was saved again since you opened it, by another admin or an accepted proposal, so your changes weren't saved. Reload to see the current one.",
      );
    }
    return {
      id: input.workflowId,
      revision: base + 1,
      maxRisk: validated.maxRisk,
      inserted: validated.inserted,
    };
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
  const latest = versions.at(0);
  return {
    id: row.id,
    name: row.name,
    specId: row.specId,
    workingSpec: row.workingSpec,
    revision: row.revision,
    // Versions hold the spec after the policy engine, so compare it with the working one's.
    unpublishedChanges: latest === undefined || !policy.ok || !sameValue(latest.spec, policy.spec),
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
