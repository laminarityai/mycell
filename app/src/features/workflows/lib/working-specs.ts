// The builder chat's reads of the org's workflows: every working spec for a turn's context, and
// which workflow has a spec ID. Each makes the same queries however many workflows and versions
// the org has.
import { asc, desc, eq, inArray } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { readStoredSpec } from "@/features/spec/stored";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import type { WorkingSpecSummary } from "../types";
import { workflows, workflowVersions } from "./schema";

/** The org's workflows by name, each with its working spec and its latest version's number. */
export async function listWorkingSpecs(ctx: Ctx): Promise<WorkingSpecSummary[]> {
  requireAdmin(ctx);
  const db = forOrg(ctx);
  const rows = await db.select(workflows, {
    columns: ["id", "name", "workingSpec"],
    orderBy: [workflows.name],
  });
  if (rows.length === 0) return [];
  // Each workflow's highest number, and nothing else of any version.
  const latest = await db.select(workflowVersions, {
    columns: ["workflowId", "number"],
    where: inArray(
      workflowVersions.workflowId,
      rows.map((row) => row.id),
    ),
    distinctOn: [workflowVersions.workflowId],
    orderBy: [asc(workflowVersions.workflowId), desc(workflowVersions.number)],
  });
  const numberOf = new Map(latest.map((version) => [version.workflowId, version.number]));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    workingSpec: readStoredSpec(row.workingSpec),
    latestVersionNumber: numberOf.get(row.id) ?? null,
  }));
}

/** The workflow with this spec ID, by its ID and name; null when none has it. */
export async function findWorkflowBySpecId(
  ctx: Ctx,
  specId: string,
): Promise<{ id: string; name: string } | null> {
  requireAdmin(ctx);
  const rows = await forOrg(ctx).select(workflows, {
    columns: ["id", "name"],
    where: eq(workflows.specId, specId),
    limit: 1,
  });
  return rows.at(0) ?? null;
}
