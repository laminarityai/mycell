// The connections a workflow's runs could use, for the pickers on its page: switching it on and
// running it on one message. The same rules as validation and switching on, so the pickers never
// offer a connection either would refuse.
import type { ConnectionSummary } from "@/features/connections/types";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import { findWorkflow } from "./access";
import { scopeIssues } from "./scope-check";
import { latestVersions, switchOf } from "./switches";
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
  const version = (await latestVersions(ctx, [workflowId])).get(workflowId);
  const spec = version?.spec ?? workflow.workingSpec;
  const usable = candidateConnections(spec, await readSetup(ctx)).filter(
    (connection) => scopeIssues(spec, [connection]).length === 0,
  );
  const on = (await switchOf(ctx, workflow))?.connectionId;
  return [
    ...usable.filter((connection) => connection.id === on),
    ...usable.filter((connection) => connection.id !== on),
  ];
}
