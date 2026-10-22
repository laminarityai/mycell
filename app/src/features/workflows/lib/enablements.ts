// Members switching member-credential workflows on and off for their own Google connection
// (M5): an enablement each. Enabling first checks the member may see the workflow and that their
// connection allows what its latest version needs; when it doesn't, it says what's missing so
// the page can take them through connecting or reconnecting, then enable again.
import { inArray } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { listConnections } from "@/features/connections/server";
import { getActionSet } from "@/features/custom-actions/server";
import { userNames } from "@/features/orgs/server";
import { type Ctx, requireAdmin } from "@/lib/ctx";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { EnablementSummary, EnableResult } from "../types";
import { findWorkflow } from "./access";
import { deleteEnablement, switchOnEnablement } from "./enablement-rows";
import { enablements } from "./schema";
import { missingAccess, unconnectedApps } from "./requirements";
import { latestVersions } from "./latest-versions";
import { getVisibleWorkflow } from "./visibility";

/**
 * Switches the workflow on for the caller's own Google connection (ADR-0014), or says what
 * stands in the way: no Google connection (`connect`), or one short of an app or scope the
 * latest version needs (`reconnect`). Enabling again changes nothing. An org-credential
 * workflow has the org switch instead, which only admins set: anyone else is refused.
 */
export async function enable(ctx: Ctx, workflowId: string): Promise<EnableResult> {
  const visible = await getVisibleWorkflow(ctx, workflowId);
  if (visible.credentials === "org") {
    requireAdmin(ctx);
    throw new ValidationError(
      "This workflow runs on an org connection: switch it on from its page.",
    );
  }
  const version = (await latestVersions(ctx, [workflowId])).get(workflowId);
  // A visible workflow is published: none means it went since it was read, so it's not found.
  if (version === undefined) throw new NotFoundError("workflow version");
  const own = (await listConnections(ctx)).connections;
  const connection = own.find((candidate) => candidate.source === "google");
  const actions = await getActionSet(ctx);
  const unconnected = unconnectedApps(version.requiredActions, own, actions);
  if (unconnected.length > 0) {
    const apps = unconnected.join(" and ");
    throw new ValidationError(
      `This workflow uses ${apps}: connect your ${apps} account first, then switch it on.`,
    );
  }
  if (connection === undefined) {
    return { needs: "connect", ...missingAccess(version, null, actions) };
  }
  const missing = missingAccess(version, connection, actions);
  if (missing.apps.length > 0 || missing.scopes.length > 0) {
    return { needs: "reconnect", connectionId: connection.id, ...missing };
  }
  await switchOnEnablement(ctx, workflowId, connection.id);
  return { enabled: true };
}

/**
 * Switches the caller's enablement of the workflow off: it goes, and new mail starts nothing
 * for them. Allowed even once they can no longer see the workflow; the org switch is untouched.
 */
export async function disable(ctx: Ctx, workflowId: string): Promise<void> {
  await findWorkflow(ctx, workflowId);
  await deleteEnablement(ctx, workflowId);
}

/**
 * Who has the workflow switched on, or paused, oldest first: admins only. It says nothing
 * from anyone's mailbox.
 */
export async function listEnablements(ctx: Ctx, workflowId: string): Promise<EnablementSummary[]> {
  requireAdmin(ctx);
  await findWorkflow(ctx, workflowId);
  return (await listEnablementsFor(ctx, [workflowId])).get(workflowId) ?? [];
}

/**
 * Each workflow's enablements, as listEnablements gives them, by workflow ID: read together,
 * for the Workflows page. A workflow not in the caller's org has none. Admins only.
 */
export async function listEnablementsFor(
  ctx: Ctx,
  workflowIds: string[],
): Promise<Map<string, EnablementSummary[]>> {
  requireAdmin(ctx);
  if (workflowIds.length === 0) return new Map();
  const [rows, nameOf] = await Promise.all([
    forOrg(ctx).select(enablements, {
      where: inArray(enablements.workflowId, workflowIds),
      orderBy: [enablements.enabledAt],
    }),
    userNames(ctx),
  ]);
  const byWorkflow = new Map(workflowIds.map((id): [string, EnablementSummary[]] => [id, []]));
  for (const row of rows) {
    byWorkflow.get(row.workflowId)?.push({
      userId: row.userId,
      name: nameOf(row.userId),
      status: row.status,
      pausedReason: row.pausedReason,
      pausedChange: row.pausedChange,
      since: row.enabledAt,
    });
  }
  return byWorkflow;
}
