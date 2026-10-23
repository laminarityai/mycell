// Disconnecting: every way a connection ends. Mycel deletes the connection at Nango, then the
// row, and each derived table's (org_id, connection_id) foreign key cascades the rest
// (invariant 3, docs/conventions.md).
import { and, eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { listUsers } from "@/features/orgs/server";
import { type Ctx, isAdmin, requireAdmin } from "@/lib/ctx";
import { ConflictError, ForbiddenError, NangoRequestError, NotFoundError } from "@/lib/errors";
import { deleteNangoConnection } from "./nango";
import { connections } from "./schema";
import { integrationOf } from "./apps";

type Connection = typeof connections.$inferSelect;

/**
 * Disconnects one connection in the caller's org. The owner may disconnect a member connection
 * and any admin an org connection; nobody else may, admins included.
 */
export async function disconnect(ctx: Ctx, connectionId: string): Promise<void> {
  const rows = await forOrg(ctx).select(connections, {
    where: eq(connections.id, connectionId),
  });
  const connection = rows.at(0);
  if (connection === undefined) throw new NotFoundError("connection");
  if (!mayManage(ctx, connection)) throw new ForbiddenError();
  await deleteConnection(ctx, connection);
}

/**
 * Deletes the member connections of a user an admin has removed from the org. Their org
 * connections stay. Their unfinished connect attempts went with their member row.
 */
export async function deleteMemberConnectionsOf(ctx: Ctx, userId: string): Promise<void> {
  requireAdmin(ctx);
  // While they're still a member, their connections are theirs alone to disconnect.
  const users = await listUsers(ctx);
  if (users.some((user) => user.id === userId)) {
    throw new ConflictError("Remove the user before deleting their connections.");
  }
  const owned = await forOrg(ctx).select(connections, {
    where: and(eq(connections.ownerUserId, userId), eq(connections.kind, "member")),
  });
  for (const connection of owned) await deleteConnection(ctx, connection);
}

/**
 * Nango deleted a connection itself (`auth` / `deletion` webhook): forget it. The org comes
 * from the webhook's signed tags; a connection Mycel doesn't have there changes nothing.
 */
export async function forgetNangoConnection(
  orgCtx: Ctx,
  nangoConnectionId: string,
  integration: string,
): Promise<void> {
  const rows = await forOrg(orgCtx).select(connections, {
    where: eq(connections.nangoConnectionId, nangoConnectionId),
  });
  const connection = rows.at(0);
  if (connection === undefined || integrationOf(connection.source) !== integration) return;
  await forOrg(orgCtx).delete(connections, eq(connections.id, connection.id));
}

/**
 * Whether the caller may disconnect or reconnect a connection: its owner for a member
 * connection, any admin for an org connection.
 */
export function mayManage(ctx: Ctx, connection: Pick<Connection, "kind" | "ownerUserId">): boolean {
  return connection.kind === "member" ? connection.ownerUserId === ctx.userId : isAdmin(ctx);
}

/**
 * Revokes Mycel's access at Nango, then deletes the row, and the cascade everything derived
 * from it. Nango failing the delete, or not answering, doesn't keep the row: Mycel forgets the
 * connection either way, and reconciliation deletes the Nango connection it no longer has a row
 * for. Any other error is Mycel's own (a bug, or how it's set up): it's thrown, and the row stays.
 */
export async function deleteConnection(ctx: Ctx, connection: Connection): Promise<void> {
  try {
    await deleteNangoConnection(connection.nangoConnectionId, integrationOf(connection.source));
  } catch (error) {
    if (!(error instanceof NangoRequestError)) throw error;
    console.warn(
      `Deleting Nango connection ${connection.nangoConnectionId} failed; reconciliation will retry.`,
      error,
    );
  }
  await forOrg(ctx).delete(connections, eq(connections.id, connection.id));
}
