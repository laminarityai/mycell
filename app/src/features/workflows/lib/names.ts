// Workflows' names, for any role: what another feature shows beside something it already let
// the caller see, such as a review on the Reviews page.
import { inArray } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
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
