// The connections a workflow's runs could use, for the pickers on its page: switching it on and
// running it on one message. The same rules as validation and switching on, so the pickers never
// offer a connection either would refuse.
import { inArray } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import type { ConnectionSummary } from "@/features/connections/types";
import { getActionSet } from "@/features/custom-actions/server";
import { readStoredSpec } from "@/features/spec/stored";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import { findWorkflow, type Workflow } from "./access";
import { scopeIssues } from "./scope-check";
import { workflows } from "./schema";
import { switchesOf } from "./switches";
import { latestVersions } from "./latest-versions";
import { candidateConnections, readSetup } from "./validation";

/**
 * The connections the workflow's latest version (its working spec, until it's published) could
 * run on: the credentials' kind, allowed Gmail, and granted every scope its actions need. The
 * connection it's switched on for comes first; the rest keep the connections page's order.
 */
export async function runnableConnections(
  ctx: Ctx,
  workflowId: string,
): Promise<ConnectionSummary[]> {
  requireAdmin(ctx);
  const workflow = await findWorkflow(ctx, workflowId);
  return (await runnableOf(ctx, [workflow])).get(workflowId) ?? [];
}

/**
 * Each workflow's runnable connections, as runnableConnections gives them, by workflow ID: read
 * together, for the Workflows page. A workflow not in the caller's org has none.
 */
export async function runnableConnectionsFor(
  ctx: Ctx,
  workflowIds: string[],
): Promise<Map<string, ConnectionSummary[]>> {
  requireAdmin(ctx);
  if (workflowIds.length === 0) return new Map();
  const rows = await forOrg(ctx).select(workflows, {
    where: inArray(workflows.id, workflowIds),
  });
  return runnableOf(
    ctx,
    rows.map((row) => ({ ...row, workingSpec: readStoredSpec(row.workingSpec) })),
  );
}

async function runnableOf(ctx: Ctx, rows: Workflow[]): Promise<Map<string, ConnectionSummary[]>> {
  const [latest, actions, setup, switches] = await Promise.all([
    latestVersions(
      ctx,
      rows.map((row) => row.id),
    ),
    getActionSet(ctx),
    readSetup(ctx),
    switchesOf(ctx, rows),
  ]);
  return new Map(
    rows.map((workflow) => {
      const spec = latest.get(workflow.id)?.spec ?? workflow.workingSpec;
      const usable = candidateConnections(spec, setup).filter(
        (connection) => scopeIssues(spec, [connection], actions).length === 0,
      );
      const on = switches.get(workflow.id)?.connectionId;
      return [
        workflow.id,
        [
          ...usable.filter((connection) => connection.id === on),
          ...usable.filter((connection) => connection.id !== on),
        ],
      ];
    }),
  );
}
