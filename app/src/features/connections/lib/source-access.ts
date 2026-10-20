// How other features reach a connection's source: read the connection, call its source through
// the Nango proxy, and record where ingest stands. Each checks the connection is in the caller's
// org and theirs to read, and turns a connection that's gone into NotFoundError.
import { eq } from "drizzle-orm";
import type { z } from "zod";
import { forOrg } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import type { ConnectionDetails, IngestStateUpdate } from "../types";
import { NangoConnectionGoneError, nangoProxyGet } from "./nango";
import { connections } from "./schema";
import { INTEGRATIONS } from "./sources";

type Connection = typeof connections.$inferSelect;

/**
 * Whether the caller may read what a connection reaches: a member connection is its owner's
 * alone (ADR-0001), and an org connection is any admin's.
 */
export function isReadableBy(ctx: Ctx, connection: Pick<Connection, "kind" | "ownerUserId">) {
  return connection.kind === "member"
    ? connection.ownerUserId === ctx.userId
    : ctx.role === "admin";
}

/** One connection the caller may read. */
export async function getConnection(ctx: Ctx, connectionId: string): Promise<ConnectionDetails> {
  const connection = await readable(ctx, connectionId);
  return {
    id: connection.id,
    source: connection.source,
    kind: connection.kind,
    ownerUserId: connection.ownerUserId,
    status: connection.status,
    cursor: connection.cursor,
  };
}

/**
 * A GET to the connection's source through the Nango proxy (never Nango syncs), parsed with
 * `schema`. Nango retries the source's 429s and 5xx. Null means the source has no such item;
 * a connection gone here or at Nango is NotFoundError.
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
      path,
      schema,
    );
  } catch (error) {
    if (error instanceof NangoConnectionGoneError) throw new NotFoundError("connection");
    throw error;
  }
}

/** Records where the connection's ingest stands: its status, backfill progress, or cursor. */
export async function recordIngestState(
  ctx: Ctx,
  connectionId: string,
  update: IngestStateUpdate,
): Promise<void> {
  await readable(ctx, connectionId);
  const updated = await forOrg(ctx).update(connections, update, eq(connections.id, connectionId));
  if (updated.length === 0) throw new NotFoundError("connection");
}

async function readable(ctx: Ctx, connectionId: string): Promise<Connection> {
  const rows = await forOrg(ctx).select(connections, { where: eq(connections.id, connectionId) });
  const connection = rows.at(0);
  if (connection === undefined) throw new NotFoundError("connection");
  if (!isReadableBy(ctx, connection)) throw new ForbiddenError();
  return connection;
}
