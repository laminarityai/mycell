// Which workflows use an action, for the custom actions page (ADR-0018): a custom action is named
// by workflows' working specs and published versions, as a catalog action is.
import { asc } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { readStoredSpec } from "@/features/spec/stored";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import type { ActionUse } from "../types";
import { latestVersions } from "./latest-versions";
import { workflows } from "./schema";
import { requiredActions } from "./policy-check";

/**
 * For each of `actionNames`, the caller's company's workflows whose working spec or latest
 * version uses it, by name, archived ones included. Admin-only, as working specs are.
 */
export async function workflowsUsingActions(
  ctx: Ctx,
  actionNames: readonly string[],
): Promise<Map<string, ActionUse[]>> {
  requireAdmin(ctx);
  const uses = new Map(actionNames.map((name): [string, ActionUse[]] => [name, []]));
  if (actionNames.length === 0) return uses;
  const rows = await forOrg(ctx).select(workflows, {
    orderBy: [asc(workflows.name), asc(workflows.id)],
  });
  const latest = await latestVersions(
    ctx,
    rows.map((row) => row.id),
  );
  for (const row of rows) {
    const working = new Set(requiredActions(readStoredSpec(row.workingSpec)));
    const version = latest.get(row.id);
    const published = new Set(version?.requiredActions);
    for (const [name, list] of uses) {
      const inWorkingSpec = working.has(name);
      const inVersion = version !== undefined && published.has(name);
      if (!inWorkingSpec && !inVersion) continue;
      list.push({
        workflowId: row.id,
        name: row.name,
        inWorkingSpec,
        publishedVersion: inVersion ? version.number : null,
        archived: row.archivedAt !== null,
      });
    }
  }
  return uses;
}
