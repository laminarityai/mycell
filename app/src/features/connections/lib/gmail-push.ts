// Which connections a Gmail notification is about (ADR-0026). The notification names only the
// mailbox's address; the push route finds its org first, then asks here inside that org.
import { and, eq, inArray } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { type Ctx, requireSystem } from "@/lib/ctx";
import { connections, ingestStates } from "./schema";

/**
 * The IDs of the org's connections to the mailbox at `address` whose Gmail is `active` and
 * that need no reconnect: those a notification for it should poll. For the push route acting
 * as the org's system ctx; anyone else is ForbiddenError.
 */
export async function gmailPushConnectionIds(ctx: Ctx, address: string): Promise<string[]> {
  requireSystem(ctx);
  const db = forOrg(ctx);
  const rows = await db.select(connections, {
    columns: ["id"],
    where: and(
      eq(connections.accountEmail, address.toLowerCase()),
      eq(connections.needsReauth, false),
    ),
    orderBy: [connections.createdAt],
  });
  if (rows.length === 0) return [];
  const active = await db.select(ingestStates, {
    columns: ["connectionId"],
    where: and(
      inArray(
        ingestStates.connectionId,
        rows.map((row) => row.id),
      ),
      eq(ingestStates.app, "gmail"),
      eq(ingestStates.status, "active"),
    ),
  });
  const activeIds = new Set(active.map((state) => state.connectionId));
  return rows.map((row) => row.id).filter((id) => activeIds.has(id));
}
