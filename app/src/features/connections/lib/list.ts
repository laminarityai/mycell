import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import { listUsers } from "@/features/orgs/server";
import { type Ctx, isAdmin } from "@/lib/ctx";
import type { ConnectionOwner, ConnectionSummary, ConnectionsListing } from "../types";
import { grantedApps, missingApps } from "./apps";
import { backfilledItems, ingestStatesOf, lastPolledAt, overallStatus } from "./ingest-states";
import { connectAttempts, connections, type ingestStates } from "./schema";

// A pending attempt older than this was abandoned (the popup closed without connecting).
// Compared in the database: created_at has no time zone, so a JS Date would be off by one.
const attemptShownSince = sql`now() - interval '1 hour'`;

type Connection = typeof connections.$inferSelect;
type IngestState = typeof ingestStates.$inferSelect;

/**
 * The connections the caller may see, and their own recent connect attempts that didn't
 * connect. A member sees only their own member connections. An admin also sees every org
 * connection, and every other member's connection as metadata only.
 */
export async function listConnections(ctx: Ctx): Promise<ConnectionsListing> {
  const db = forOrg(ctx);
  const admin = isAdmin(ctx);
  const rows = await db.select(connections, {
    where: admin
      ? undefined
      : and(eq(connections.ownerUserId, ctx.userId), eq(connections.kind, "member")),
    orderBy: [connections.accountEmail, connections.source],
  });
  const states = await ingestStatesOf(
    ctx,
    rows.map((row) => row.id),
  );
  const attempts = await db.select(connectAttempts, {
    where: and(
      eq(connectAttempts.userId, ctx.userId),
      inArray(connectAttempts.status, ["pending", "refused"]),
      gt(connectAttempts.createdAt, attemptShownSince),
    ),
    orderBy: [desc(connectAttempts.createdAt)],
  });
  const ownerOf = await ownerLookup(ctx);
  const summaryOf = (row: Connection) => summary(row, states.get(row.id) ?? []);
  const memberRows = rows.filter((row) => row.kind === "member");
  return {
    connections: memberRows.filter((row) => row.ownerUserId === ctx.userId).map(summaryOf),
    orgConnections: rows
      .filter((row) => row.kind === "org")
      .map((row) => ({ ...summaryOf(row), owner: ownerOf(row.ownerUserId) })),
    memberConnections: memberRows
      .filter((row) => row.ownerUserId !== ctx.userId)
      .map((row) => ({
        id: row.id,
        source: row.source,
        apps: grantedApps(row.source, row.grantedScopes),
        status: summaryOf(row).status,
        owner: ownerOf(row.ownerUserId),
        createdAt: row.createdAt,
      })),
    attempts: attempts.flatMap((attempt) =>
      attempt.status === "connected"
        ? []
        : [
            {
              id: attempt.id,
              source: attempt.source,
              kind: attempt.kind,
              status: attempt.status,
              refusal: attempt.refusal,
              createdAt: attempt.createdAt,
            },
          ],
    ),
  };
}

function summary(row: Connection, states: IngestState[]): ConnectionSummary {
  return {
    id: row.id,
    source: row.source,
    kind: row.kind,
    accountEmail: row.accountEmail,
    status: overallStatus(row.needsReauth, states),
    grantedScopes: row.grantedScopes,
    apps: grantedApps(row.source, row.grantedScopes),
    missingApps: missingApps(row.source, row.grantedScopes),
    backfilledItems: backfilledItems(states),
    lastPolledAt: lastPolledAt(states),
    createdAt: row.createdAt,
  };
}

// Resolves an owner's user ID against the org's current users. An owner who isn't one any
// more was removed: their org connections live on, flagged.
export async function ownerLookup(ctx: Ctx): Promise<(userId: string) => ConnectionOwner> {
  const users = new Map((await listUsers(ctx)).map((user) => [user.id, user.name]));
  return (userId) => {
    const name = users.get(userId);
    return name === undefined ? { userId, removed: true } : { userId, removed: false, name };
  };
}
