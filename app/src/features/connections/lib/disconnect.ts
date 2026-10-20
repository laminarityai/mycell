// Disconnecting: every way a connection ends. Mycel deletes the connection at Nango, then the
// row, and each derived table's (org_id, connection_id) foreign key cascades the rest
// (invariant 3, docs/conventions.md).
import { and, eq } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { listUsers } from "@/features/orgs/server";
import type { Ctx } from "@/lib/ctx";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { deleteNangoConnection } from "./nango";
import { connections } from "./schema";
import { INTEGRATIONS } from "./sources";

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
  if (!mayDisconnect(ctx, connection)) throw new ForbiddenError();
  await deleteConnection(ctx, connection);
}

/**
 * Deletes the member connections of a user an admin has removed from the org. Their org
 * connections stay. Their unfinished connect attempts went with their member row.
 */
export async function deleteMemberConnectionsOf(ctx: Ctx, userId: string): Promise<void> {
  if (ctx.role !== "admin") throw new ForbiddenError();
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
  if (connection === undefined || INTEGRATIONS[connection.source] !== integration) return;
  await forOrg(orgCtx).delete(connections, eq(connections.id, connection.id));
}

function mayDisconnect(ctx: Ctx, connection: Connection): boolean {
  return connection.kind === "member"
    ? connection.ownerUserId === ctx.userId
    : ctx.role === "admin";
}

// Revokes Mycel's access at Nango, then deletes the row. A failed Nango delete doesn't keep
// the row: Mycel forgets the connection either way, and reconciliation deletes the Nango
// connection it no longer has a row for.
async function deleteConnection(ctx: Ctx, connection: Connection): Promise<void> {
  try {
    await deleteNangoConnection(connection.nangoConnectionId, INTEGRATIONS[connection.source]);
  } catch (error) {
    console.warn(
      `Deleting Nango connection ${connection.nangoConnectionId} failed; reconciliation will retry.`,
      error,
    );
  }
  await forOrg(ctx).delete(connections, eq(connections.id, connection.id));
}
