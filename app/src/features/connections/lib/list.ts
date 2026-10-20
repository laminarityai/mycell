import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
import type { ConnectionsListing } from "../types";
import { connectAttempts, connections } from "./schema";

// A pending attempt older than this was abandoned (the popup closed without connecting).
// Compared in the database: created_at has no time zone, so a JS Date would be off by one.
const attemptShownSince = sql`now() - interval '1 hour'`;

/** The caller's own connections, and their recent connect attempts that didn't connect. */
export async function listConnections(ctx: Ctx): Promise<ConnectionsListing> {
  const db = forOrg(ctx);
  const rows = await db.select(connections, {
    where: eq(connections.ownerUserId, ctx.userId),
    orderBy: [connections.source, connections.accountEmail],
  });
  const attempts = await db.select(connectAttempts, {
    where: and(
      eq(connectAttempts.userId, ctx.userId),
      inArray(connectAttempts.status, ["pending", "refused"]),
      gt(connectAttempts.createdAt, attemptShownSince),
    ),
    orderBy: [desc(connectAttempts.createdAt)],
  });
  return {
    connections: rows.map((row) => ({
      id: row.id,
      source: row.source,
      kind: row.kind,
      accountEmail: row.accountEmail,
      status: row.status,
      createdAt: row.createdAt,
    })),
    attempts: attempts.flatMap((attempt) =>
      attempt.status === "connected"
        ? []
        : [
            {
              id: attempt.id,
              source: attempt.source,
              status: attempt.status,
              refusal: attempt.refusal,
              createdAt: attempt.createdAt,
            },
          ],
    ),
  };
}
