// Switching workflows on and off. A member-credential workflow is switched on by an enablement on
// the admin's own member connection; an org-credential workflow by its one switch, naming an org
// connection. Either follows the workflow's latest version. Admin-only in M3 (members toggle in
// M5); runs read what's on as the system ctx.
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { isUniqueViolation } from "@/db/errors";
import { forOrg } from "@/db/for-org";
import { listConnections } from "@/features/connections/server";
import type { ConnectionSummary } from "@/features/connections/types";
import type { Spec, SpecIssue } from "@/features/spec/types";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError, SpecInvalidError, ValidationError } from "@/lib/errors";
import type { Switch, SwitchedOn, WorkflowSwitch, WorkflowVersion } from "../types";
import { enablements, workflows, workflowVersions } from "./schema";
import { scopeIssues } from "./scope-check";
import { reachesGmail } from "./validation";
import { version } from "./versions";
import { findWorkflow } from "./access";

type Workflow = typeof workflows.$inferSelect;

/**
 * Switches the workflow on for `connectionId`, from now on: messages that arrived earlier start
 * nothing. The latest version is checked against that connection alone, since it's the one the
 * runs will use. Switching on again for the same connection changes nothing; for another one,
 * moves the switch there from now.
 */
export async function switchWorkflowOn(
  ctx: Ctx,
  workflowId: string,
  connectionId: string,
): Promise<void> {
  requireAdmin(ctx);
  const workflow = await findWorkflow(ctx, workflowId);
  const version = (await latestVersions(ctx, [workflowId])).get(workflowId);
  if (version === undefined) {
    throw new ValidationError("Publish the workflow before switching it on.");
  }
  const connection = await chosenConnection(ctx, version.spec, connectionId);
  const issues = connectionIssues(version.spec, connection);
  if (issues.length > 0) throw new SpecInvalidError(issues);

  if (version.spec.credentials === "org") {
    if (workflow.orgConnectionId === connectionId) return;
    await forOrg(ctx).update(
      workflows,
      { orgConnectionId: connectionId, orgSwitchedOnAt: new Date() },
      eq(workflows.id, workflowId),
    );
    return;
  }
  await enable(ctx, workflowId, connectionId);
}

/** Switches the workflow off: the caller's enablement goes, and so does the org switch. */
export async function switchWorkflowOff(ctx: Ctx, workflowId: string): Promise<void> {
  requireAdmin(ctx);
  await findWorkflow(ctx, workflowId);
  const db = forOrg(ctx);
  await db.delete(
    enablements,
    and(eq(enablements.workflowId, workflowId), eq(enablements.userId, ctx.userId)),
  );
  await db.update(
    workflows,
    { orgConnectionId: null, orgSwitchedOnAt: null },
    eq(workflows.id, workflowId),
  );
}

/**
 * What's switched on for one connection, each with the latest version it runs: the trigger's
 * fan-out reads it as the system ctx (ADR-0009). A switch whose latest version names the other
 * credentials (republished from member to org, say) is left out until switched on again.
 */
export async function listSwitchedOn(ctx: Ctx, connectionId: string): Promise<SwitchedOn[]> {
  if (ctx.role !== "system") throw new ForbiddenError();
  const db = forOrg(ctx);
  const enabled = await db.select(enablements, {
    where: eq(enablements.connectionId, connectionId),
    orderBy: [enablements.enabledAt],
  });
  const orgSwitched = await db.select(workflows, {
    where: eq(workflows.orgConnectionId, connectionId),
    orderBy: [workflows.orgSwitchedOnAt],
  });
  const latest = await latestVersions(ctx, [
    ...enabled.map((row) => row.workflowId),
    ...orgSwitched.map((row) => row.id),
  ]);
  const on = (workflowId: string, by: Switch, since: Date | null): SwitchedOn[] => {
    const version = latest.get(workflowId);
    if (version === undefined || since === null || version.spec.credentials !== by.kind) {
      return [];
    }
    return [
      {
        workflowId,
        switch: by,
        versionId: version.id,
        since,
        labelIds: version.spec.trigger.labelIds,
      },
    ];
  };
  return [
    ...enabled.flatMap((row) =>
      on(row.workflowId, { kind: "member", enablementId: row.id }, row.enabledAt),
    ),
    ...orgSwitched.flatMap((row) =>
      on(row.id, { kind: "org", workflowId: row.id }, row.orgSwitchedOnAt),
    ),
  ];
}

/** The workflow's switch as the caller sees it: their own enablement, or the org switch. */
export async function switchOf(ctx: Ctx, workflow: Workflow): Promise<WorkflowSwitch | null> {
  return (await switchesOf(ctx, [workflow])).get(workflow.id) ?? null;
}

/** Each workflow's switch as the caller sees it, by workflow ID, in one read. */
export async function switchesOf(
  ctx: Ctx,
  rows: Workflow[],
): Promise<Map<string, WorkflowSwitch | null>> {
  const own =
    rows.length === 0
      ? []
      : await forOrg(ctx).select(enablements, {
          where: and(
            eq(enablements.userId, ctx.userId),
            inArray(
              enablements.workflowId,
              rows.map((row) => row.id),
            ),
          ),
        });
  const ownOf = new Map(own.map((enablement) => [enablement.workflowId, enablement]));
  return new Map(rows.map((row) => [row.id, switchFrom(row, ownOf.get(row.id))]));
}

function switchFrom(
  workflow: Workflow,
  own: typeof enablements.$inferSelect | undefined,
): WorkflowSwitch | null {
  if (own !== undefined) {
    return { kind: "member", connectionId: own.connectionId, since: own.enabledAt };
  }
  if (workflow.orgConnectionId === null || workflow.orgSwitchedOnAt === null) return null;
  return { kind: "org", connectionId: workflow.orgConnectionId, since: workflow.orgSwitchedOnAt };
}

async function enable(ctx: Ctx, workflowId: string, connectionId: string): Promise<void> {
  const db = forOrg(ctx);
  const mine = and(eq(enablements.workflowId, workflowId), eq(enablements.userId, ctx.userId));
  const existing = (await db.select(enablements, { where: mine, limit: 1 })).at(0);
  if (existing?.connectionId === connectionId) return;
  if (existing !== undefined) {
    await db.update(enablements, { connectionId, enabledAt: new Date() }, mine);
    return;
  }
  try {
    await db.insert(enablements, {
      id: randomUUID(),
      workflowId,
      userId: ctx.userId,
      connectionId,
      // Set here rather than by the column's default: it's compared with messages' times,
      // which are written from JS too (the column has no time zone).
      enabledAt: new Date(),
    });
  } catch (error) {
    // Switched on twice at once: the other switch-on won, and it's on.
    if (!isUniqueViolation(error, "enablements_workflow_id_user_id_unique")) throw error;
  }
}

/**
 * The connection the admin chose, from those the spec's credentials allow: their own member
 * connections, or the org's. Another member's connection is "not found", as it is elsewhere.
 */
async function chosenConnection(
  ctx: Ctx,
  spec: Spec,
  connectionId: string,
): Promise<ConnectionSummary> {
  const listing = await listConnections(ctx);
  const own = listing.connections.find((connection) => connection.id === connectionId);
  const org = listing.orgConnections.find((connection) => connection.id === connectionId);
  const chosen = spec.credentials === "member" ? own : org;
  if (chosen !== undefined) return chosen;
  if (own !== undefined || org !== undefined) {
    throw new ValidationError(
      spec.credentials === "member"
        ? "This workflow runs on your own connection, not an org connection."
        : "This workflow runs on an org connection, not your own.",
    );
  }
  throw new NotFoundError("connection");
}

// The setup checks, against the one chosen connection.
function connectionIssues(spec: Spec, connection: ConnectionSummary): SpecIssue[] {
  if (!reachesGmail(connection)) {
    return [
      {
        path: ["credentials"],
        message: `${connection.accountEmail} wasn't allowed Gmail. Reconnect it to allow Gmail.`,
      },
    ];
  }
  return scopeIssues(spec, [connection]);
}

/** Each workflow's latest version, by workflow ID; none for a workflow never published. */
export async function latestVersions(
  ctx: Ctx,
  workflowIds: string[],
): Promise<Map<string, WorkflowVersion>> {
  const latest = new Map<string, WorkflowVersion>();
  if (workflowIds.length === 0) return latest;
  const rows = await forOrg(ctx).select(workflowVersions, {
    where: inArray(workflowVersions.workflowId, workflowIds),
    orderBy: [desc(workflowVersions.number)],
  });
  for (const row of rows) {
    if (!latest.has(row.workflowId)) latest.set(row.workflowId, version(row));
  }
  return latest;
}
