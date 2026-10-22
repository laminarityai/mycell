// Saving and reading workflows. Admin-only in M3: members get ForbiddenError for every one.
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { isUniqueViolation } from "@/db/errors";
import { forOrg, type OrgScopedDb } from "@/db/for-org";
import { actionSetWith, checkedCustomActions } from "@/features/custom-actions/description";
import {
  getActionSet,
  listCustomActions,
  storeCustomActions,
} from "@/features/custom-actions/server";
import { applyPolicy } from "@/features/policy/engine";
import type { ActionSet } from "@/features/policy/types";
import { sameValue } from "@/features/spec/diff";
import { readStoredSpec } from "@/features/spec/stored";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import { ConflictError, ValidationError } from "@/lib/errors";
import type {
  CheckedSave,
  SavedWorkflow,
  WorkflowDetails,
  WorkflowInput,
  WorkflowSummary,
  WorkflowVersionSummary,
} from "../types";
import { findWorkflow } from "./access";
import { latestVersions } from "./latest-versions";
import { workflows, workflowVersions } from "./schema";
import { switchesOf, switchOf } from "./switches";
import { validateWorkflowSpec } from "./validation";
import { audiencesOf } from "./visibility";

type Version = typeof workflowVersions.$inferSelect;

/**
 * Validates the spec in full and saves it as a workflow's working spec: a new workflow when
 * `workflowId` is left out. A spec that fails isn't saved; SpecInvalidError carries every issue.
 * Publishing is separate, so saving never changes what runs. Each save moves the working spec's
 * revision on; with `baseRevision`, a save from a revision that has since moved on is refused
 * with ConflictError, never merged.
 */
export async function saveWorkflow(ctx: Ctx, input: WorkflowInput): Promise<SavedWorkflow> {
  const checked = await checkWorkflowSave(ctx, input);
  return forOrg(ctx).transaction((tx) => saveWorkflowIn(ctx, tx, checked));
}

/**
 * Everything saveWorkflow reads and checks, without writing: a caller saving inside its own
 * transaction (accepting a proposal) calls it before the transaction, then saveWorkflowIn in it.
 */
export async function checkWorkflowSave(ctx: Ctx, input: WorkflowInput): Promise<CheckedSave> {
  requireAdmin(ctx);
  const name = input.name.trim();
  if (name === "") throw new ValidationError("Give the workflow a name.");
  const existing =
    input.workflowId === undefined ? undefined : await findWorkflow(ctx, input.workflowId);
  // The custom actions it brings (a proposal's, stored as JSON) are checked again first, so the
  // spec is validated against the levels the rule sets now, not the ones the proposal carried.
  const brought = input.newCustomActions;
  const bringing = checkedCustomActions(brought?.actions ?? []);
  const actions = actionSetWith([...(await listCustomActions(ctx)), ...bringing]);
  const validated = await validateWorkflowSpec(ctx, input.spec, actions);
  return {
    workflowId: input.workflowId,
    baseRevision: input.baseRevision ?? existing?.revision ?? 1,
    values: { name, specId: validated.working.id, workingSpec: validated.working },
    newCustomActions:
      brought === undefined ? undefined : { actions: bringing, proposalId: brought.proposalId },
    maxRisk: validated.maxRisk,
    inserted: validated.inserted,
  };
}

/**
 * Writes a checked save through the caller's transaction `tx`, querying nothing else: its
 * custom actions first, which stay only if the spec saves too. ConflictError when the working
 * spec moved on from `baseRevision`, or another workflow has the spec ID.
 */
export async function saveWorkflowIn(
  ctx: Ctx,
  tx: OrgScopedDb,
  checked: CheckedSave,
): Promise<SavedWorkflow> {
  requireAdmin(ctx);
  const { workflowId, baseRevision: base, values, newCustomActions, maxRisk, inserted } = checked;
  if (newCustomActions !== undefined) {
    const { actions, proposalId } = newCustomActions;
    await storeCustomActions(ctx, actions, { proposalId }, tx);
  }
  try {
    if (workflowId === undefined) {
      const id = randomUUID();
      await tx.insert(workflows, { ...values, id, createdBy: ctx.userId });
      return { id, revision: 1, maxRisk, inserted };
    }
    // One conditional update: it saves only while the working spec is still at `base`.
    const updated = await tx.update(
      workflows,
      { ...values, revision: base + 1, updatedAt: new Date() },
      and(eq(workflows.id, workflowId), eq(workflows.revision, base)),
    );
    if (updated.length === 0) {
      throw new ConflictError(
        "The working spec was saved again since you opened it, by another admin or an accepted proposal, so your changes weren't saved. Reload to see the current one.",
      );
    }
    return { id: workflowId, revision: base + 1, maxRisk, inserted };
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
  const rows = await forOrg(ctx).select(workflows, { orderBy: [workflows.name] });
  const [latest, switches] = await Promise.all([
    latestVersions(
      ctx,
      rows.map((row) => row.id),
    ),
    switchesOf(ctx, rows),
  ]);
  const audiences = await audiencesOf(
    ctx,
    [...latest.values()].map((version) => version.id),
  );
  return rows.map((row) => {
    const version = latest.get(row.id);
    return {
      id: row.id,
      name: row.name,
      specId: row.specId,
      latestVersion: version === undefined ? null : versionSummary(version),
      credentials: version === undefined ? null : version.spec.credentials,
      switch: switches.get(row.id) ?? null,
      audience: version === undefined ? null : (audiences.get(version.id) ?? null),
      archivedAt: row.archivedAt,
      updatedAt: row.updatedAt,
    };
  });
}

/**
 * One workflow, with what the policy engine makes of its working spec and its versions. A caller
 * reading several passes the company's action set, resolved once, as `actions`.
 */
export async function getWorkflow(
  ctx: Ctx,
  workflowId: string,
  actions?: ActionSet,
): Promise<WorkflowDetails> {
  requireAdmin(ctx);
  const row = await findWorkflow(ctx, workflowId);
  const versions = await forOrg(ctx).select(workflowVersions, {
    where: eq(workflowVersions.workflowId, workflowId),
    orderBy: [desc(workflowVersions.number)],
  });
  const policy = applyPolicy(row.workingSpec, actions ?? (await getActionSet(ctx)));
  const latest = versions.at(0);
  return {
    id: row.id,
    name: row.name,
    specId: row.specId,
    workingSpec: row.workingSpec,
    revision: row.revision,
    // Versions hold the spec after the policy engine, so compare it with the working one's.
    unpublishedChanges:
      latest === undefined || !policy.ok || !sameValue(readStoredSpec(latest.spec), policy.spec),
    maxRisk: policy.ok ? policy.maxRisk : null,
    inserted: policy.ok ? policy.inserted : [],
    versions: versions.map(versionSummary),
    switch: await switchOf(ctx, row),
    archivedAt: row.archivedAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
  };
}

export function versionSummary(
  version: Pick<Version, "id" | "number" | "maxRisk" | "publishedBy" | "publishedAt">,
): WorkflowVersionSummary {
  return {
    id: version.id,
    number: version.number,
    maxRisk: version.maxRisk,
    publishedBy: version.publishedBy,
    publishedAt: version.publishedAt,
  };
}
