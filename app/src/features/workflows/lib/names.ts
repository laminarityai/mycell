// Workflows' names and current versions, for any role: what another feature shows beside, or
// counts by, something it already let the caller see, such as a review on the Reviews page.
import { inArray } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
import { latestVersions } from "./latest-versions";
import { workflows } from "./schema";

/**
 * The names of the workflows with these IDs in the caller's org, by ID. An ID from another org,
 * or of no workflow, has no entry. Names only: the caller has already decided what may be seen.
 */
export async function workflowNames(ctx: Ctx, workflowIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(workflowIds)];
  if (ids.length === 0) return new Map();
  const rows = await forOrg(ctx).select(workflows, { where: inArray(workflows.id, ids) });
  return new Map(rows.map((row) => [row.id, row.name]));
}

/**
 * The ID of each published workflow's current (latest) version, by workflow ID, for those with
 * these IDs in the caller's org: what review counts "since the current version" count by. IDs
 * only.
 */
export async function currentVersionIds(
  ctx: Ctx,
  workflowIds: string[],
): Promise<Map<string, string>> {
  const latest = await latestVersions(ctx, [...new Set(workflowIds)]);
  return new Map([...latest].map(([workflowId, version]) => [workflowId, version.id]));
}
