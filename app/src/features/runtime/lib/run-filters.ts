// What the Runs page's filters offer: the workflows and inboxes of the runs the caller may see,
// counted in Postgres, so a choice never finds nothing for want of runs.
import { forOrg } from "@/db/for-org";
import { workflowNames } from "@/features/workflows/server";
import type { Ctx } from "@/lib/ctx";
import type { RunFilterOptions } from "../types";
import { inboxOf, visibleRuns } from "./run-list";
import { runs } from "./schema";

/** The workflows, by name, and the inboxes the caller's runs are on. */
export async function listRunFilters(ctx: Ctx): Promise<RunFilterOptions> {
  const { owners, visible } = await visibleRuns(ctx);
  if (visible === null) return { workflows: [], connections: [] };
  const groups = await forOrg(ctx).countBy(
    runs,
    { workflowId: runs.workflowId, connectionId: runs.connectionId },
    visible,
  );
  const names = await workflowNames(
    ctx,
    groups.map((group) => group.workflowId),
  );
  const connectionIds = new Set(groups.map((group) => group.connectionId));
  return {
    workflows: [...names]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    // In the order the connections were made.
    connections: [...owners.values()]
      .filter((owner) => connectionIds.has(owner.id))
      .map((owner) => ({ id: owner.id, inbox: inboxOf(owner) })),
  };
}
