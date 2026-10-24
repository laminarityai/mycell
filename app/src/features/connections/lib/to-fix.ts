// The connections waiting on the caller to fix them, for admins' alerts: their own member
// connections and, for an admin, the org's, that need reconnecting or whose backfill failed.
// Reconnecting fixes both, and only the caller can do it (an org connection's any admin).
import { and, eq, inArray, or } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { type Ctx, isAdmin } from "@/lib/ctx";
import type { ConnectionToFix } from "../types";
import { connections, ingestStates } from "./schema";

/**
 * The caller's connections that need them, by account: `needs_reauth` when the app stopped
 * accepting Mycel's access, else `failed` when an app's backfill gave up. Two queries, returning
 * only those connections, however many the org has.
 */
export async function listConnectionsToFix(ctx: Ctx): Promise<ConnectionToFix[]> {
  const db = forOrg(ctx);
  const failed = await db.select(ingestStates, {
    columns: ["connectionId"],
    where: eq(ingestStates.status, "failed"),
  });
  const failedIds = [...new Set(failed.map((state) => state.connectionId))];
  const rows = await db.select(connections, {
    columns: ["id", "source", "kind", "accountEmail", "needsReauth"],
    where: and(
      isAdmin(ctx)
        ? or(eq(connections.kind, "org"), eq(connections.ownerUserId, ctx.userId))
        : and(eq(connections.kind, "member"), eq(connections.ownerUserId, ctx.userId)),
      failedIds.length === 0
        ? eq(connections.needsReauth, true)
        : or(eq(connections.needsReauth, true), inArray(connections.id, failedIds)),
    ),
    orderBy: [connections.accountEmail, connections.source],
  });
  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    kind: row.kind,
    accountEmail: row.accountEmail,
    status: row.needsReauth ? "needs_reauth" : "failed",
  }));
}
