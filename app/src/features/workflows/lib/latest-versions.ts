// Reading published versions: a version's row in the current spec's shape, and each workflow's
// latest one, which is what everything switched on follows.
import { asc, desc, inArray } from "drizzle-orm";
import { forOrg, type OrgScopedDb } from "@/db/for-org";
import { readStoredSpec } from "@/features/spec/stored";
import type { Ctx } from "@/lib/ctx";
import type { WorkflowVersion } from "../types";
import { workflowVersions } from "./schema";

type Version = typeof workflowVersions.$inferSelect;

/** A version's row as a WorkflowVersion, its spec read in the current version's shape. */
export function version(row: Version): WorkflowVersion {
  return {
    id: row.id,
    workflowId: row.workflowId,
    number: row.number,
    spec: readStoredSpec(row.spec),
    maxRisk: row.maxRisk,
    requiredActions: row.requiredActions,
    publishedBy: row.publishedBy,
    publishedAt: row.publishedAt,
  };
}

/**
 * Each workflow's latest version, by workflow ID; none for a workflow never published. Read
 * through `db`, which a publish passes to see the version it's writing.
 */
export async function latestVersions(
  ctx: Ctx,
  workflowIds: string[],
  db: OrgScopedDb = forOrg(ctx),
): Promise<Map<string, WorkflowVersion>> {
  if (workflowIds.length === 0) return new Map();
  // One row per workflow, its highest number: older versions, specs and all, stay in Postgres.
  const rows = await db.select(workflowVersions, {
    where: inArray(workflowVersions.workflowId, workflowIds),
    distinctOn: [workflowVersions.workflowId],
    orderBy: [asc(workflowVersions.workflowId), desc(workflowVersions.number)],
  });
  return new Map(rows.map((row) => [row.workflowId, version(row)]));
}
