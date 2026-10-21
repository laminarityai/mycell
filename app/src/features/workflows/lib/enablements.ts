// Members switching member-credential workflows on and off for their own Google connection
// (M5): an enablement each. Enabling first checks the member may see the workflow and that their
// connection allows what its latest version needs; when it doesn't, it says what's missing so
// the page can take them through connecting or reconnecting, then enable again.
import { eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { listConnections } from "@/features/connections/server";
import { listUsers } from "@/features/orgs/server";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import type { EnablementSummary, EnableResult } from "../types";
import { findWorkflow } from "./access";
import { deleteEnablement, switchOnEnablement } from "./enablement-rows";
import { enablements } from "./schema";
import { missingAccess } from "./requirements";
import { latestVersions } from "./versions";
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
    if (ctx.role !== "admin") throw new ForbiddenError();
    throw new ValidationError(
      "This workflow runs on an org connection: switch it on from its page.",
    );
  }
  const version = (await latestVersions(ctx, [workflowId])).get(workflowId);
  if (version === undefined) throw new Error(`Visible workflow ${workflowId} has no version`);
  const connection = (await listConnections(ctx)).connections.find(
    (own) => own.source === "google",
  );
  if (connection === undefined) return { needs: "connect", ...missingAccess(version, null) };
  const missing = missingAccess(version, connection);
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
  const rows = await forOrg(ctx).select(enablements, {
    where: eq(enablements.workflowId, workflowId),
    orderBy: [enablements.enabledAt],
  });
  const names = new Map((await listUsers(ctx)).map((user) => [user.id, user.name]));
  return rows.map((row) => ({
    userId: row.userId,
    name: names.get(row.userId) ?? "",
    status: row.status,
    pausedReason: row.pausedReason,
    pausedChange: row.pausedChange,
    since: row.enabledAt,
  }));
}
