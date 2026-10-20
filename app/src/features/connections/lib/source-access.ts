// How other features reach a connection's source: read the connection and what it was granted,
// call its source through the Nango proxy, and record where each app's ingest stands. Each
// checks the connection is in the caller's org and theirs to read, and turns a connection
// that's gone into NotFoundError.
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { forOrg } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { ConnectionDetails, IngestedApp, IngestStateUpdate } from "../types";
import { grantedApps, INTEGRATIONS, proxyTarget } from "./google";
import { ingestByApp, ingestStatesOf } from "./ingest-states";
import { NangoConnectionGoneError, nangoProxyGet } from "./nango";
import { connections, ingestStates } from "./schema";

type Connection = typeof connections.$inferSelect;

/**
 * Whether the caller may read what a connection reaches: a member connection is its owner's
 * alone (ADR-0001), and an org connection is any admin's. The system ctx, which scheduled jobs
 * act as, may read every connection in its org (ADR-0009): it ingests for their owners.
 */
export function isReadableBy(ctx: Ctx, connection: Pick<Connection, "kind" | "ownerUserId">) {
  if (ctx.role === "system") return true;
  return connection.kind === "member"
    ? connection.ownerUserId === ctx.userId
    : ctx.role === "admin";
}

/** One connection the caller may read. */
export async function getConnection(ctx: Ctx, connectionId: string): Promise<ConnectionDetails> {
  const connection = await readable(ctx, connectionId);
  return details(connection, (await ingestStatesOf(ctx, [connection.id])).get(connection.id));
}

/**
 * The OAuth scopes Google granted a connection the caller may read, as full scope URLs (such as
 * https://www.googleapis.com/auth/gmail.modify). Recorded when the connection was made and on
 * each reconnect, so it's what Google allowed then.
 */
export async function getGrantedScopes(ctx: Ctx, connectionId: string): Promise<string[]> {
  return (await readable(ctx, connectionId)).grantedScopes;
}

/**
 * Every connection in the org, for scheduled jobs (polling, reconciliation) acting as the
 * system ctx. Anyone else is ForbiddenError: users list connections with listConnections.
 */
export async function listConnectionsForJobs(ctx: Ctx): Promise<ConnectionDetails[]> {
  if (ctx.role !== "system") throw new ForbiddenError();
  const rows = await forOrg(ctx).select(connections, { orderBy: [connections.createdAt] });
  const states = await ingestStatesOf(
    ctx,
    rows.map((row) => row.id),
  );
  return rows.map((row) => details(row, states.get(row.id)));
}

function details(
  connection: Connection,
  states: Parameters<typeof ingestByApp>[0] = [],
): ConnectionDetails {
  return {
    id: connection.id,
    source: connection.source,
    kind: connection.kind,
    ownerUserId: connection.ownerUserId,
    needsReauth: connection.needsReauth,
    grantedScopes: connection.grantedScopes,
    apps: grantedApps(connection.source, connection.grantedScopes),
    ingest: ingestByApp(states),
  };
}

/**
 * A GET to a Google API through the Nango proxy (never Nango syncs), parsed with `schema`. The
 * path is the API's own (`/gmail/v1/users/me/...`, `/drive/v3/...`, `/v4/spreadsheets/...`)
 * and decides which API host the call reaches. Nango retries the source's 429s and 5xx. Null
 * means the source has no such item; a connection gone here or at Nango is NotFoundError.
 */
export async function proxyGet<T>(
  ctx: Ctx,
  connectionId: string,
  path: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const connection = await readable(ctx, connectionId);
  try {
    return await nangoProxyGet(
      {
        connectionId: connection.nangoConnectionId,
        integration: INTEGRATIONS[connection.source],
      },
      proxyTarget(path),
      schema,
    );
  } catch (error) {
    if (error instanceof NangoConnectionGoneError) throw new NotFoundError("connection");
    throw error;
  }
}

/**
 * Records where one app's ingest stands on the connection: its status, backfill progress,
 * cursor or last poll. NotFoundError if the connection, or the app on it, is gone.
 */
export async function recordIngestState(
  ctx: Ctx,
  connectionId: string,
  app: IngestedApp,
  update: IngestStateUpdate,
): Promise<void> {
  await readable(ctx, connectionId);
  const updated = await forOrg(ctx).update(
    ingestStates,
    update,
    and(eq(ingestStates.connectionId, connectionId), eq(ingestStates.app, app)),
  );
  if (updated.length === 0) throw new NotFoundError("connection");
}

async function readable(ctx: Ctx, connectionId: string): Promise<Connection> {
  const rows = await forOrg(ctx).select(connections, { where: eq(connections.id, connectionId) });
  const connection = rows.at(0);
  if (connection === undefined) throw new NotFoundError("connection");
  if (!isReadableBy(ctx, connection)) throw new ForbiddenError();
  return connection;
}
