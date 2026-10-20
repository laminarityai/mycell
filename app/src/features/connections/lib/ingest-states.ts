// Where each ingested app stands on a connection. A state starts when the connection is
// recorded, or a reconnect grants its app; discovery's ingest moves it along; a reconnect that
// leaves its app out drops it. Deleting the connection cascades to its states.
import { randomUUID } from "node:crypto";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { forOrg } from "@/db/for-org";
import type { Ctx } from "@/lib/ctx";
import {
  ingestedAppSchema,
  type AppIngestState,
  type ConnectionStatus,
  type GoogleApp,
  type IngestedApp,
} from "../types";
import { ingestStates } from "./schema";

type IngestStateRow = typeof ingestStates.$inferSelect;

/**
 * Makes the connection's states match the apps it may use: a `backfilling` state for each
 * ingested app among `apps` that has none, and none for an app it may no longer use. Returns
 * the IDs of the states it started.
 */
export async function syncIngestStates(
  ctx: Ctx,
  connectionId: string,
  apps: readonly GoogleApp[],
): Promise<string[]> {
  const db = forOrg(ctx);
  const ingested = ingestedAppSchema.options.filter((app) => apps.includes(app));
  await db.delete(
    ingestStates,
    and(eq(ingestStates.connectionId, connectionId), notInArray(ingestStates.app, ingested)),
  );
  const started = await db.insert(
    ingestStates,
    ingested.map((app) => ({
      id: randomUUID(),
      connectionId,
      app,
      status: "backfilling" as const,
    })),
    { onConflictDoNothing: true },
  );
  return started.map((state) => state.id);
}

/** Drops states by ID: undoes a sync whose announcement didn't go out. */
export async function dropIngestStates(ctx: Ctx, ids: string[]): Promise<void> {
  await forOrg(ctx).delete(ingestStates, inArray(ingestStates.id, ids));
}

/** The states of these connections, by connection ID. */
export async function ingestStatesOf(
  ctx: Ctx,
  connectionIds: string[],
): Promise<Map<string, IngestStateRow[]>> {
  const rows =
    connectionIds.length === 0
      ? []
      : await forOrg(ctx).select(ingestStates, {
          where: inArray(ingestStates.connectionId, connectionIds),
          orderBy: [ingestStates.app],
        });
  const byConnection = new Map<string, IngestStateRow[]>();
  for (const row of rows) {
    byConnection.set(row.connectionId, [...(byConnection.get(row.connectionId) ?? []), row]);
  }
  return byConnection;
}

/** A connection's states, keyed by app. */
export function ingestByApp(rows: IngestStateRow[]): Partial<Record<IngestedApp, AppIngestState>> {
  return Object.fromEntries(
    rows.map((row) => [
      row.app,
      {
        status: row.status,
        cursor: row.cursor,
        backfilledItems: row.backfilledItems,
        lastPolledAt: row.lastPolledAt,
      },
    ]),
  );
}

/** Where the connection stands as a whole (see ConnectionStatus). */
export function overallStatus(needsReauth: boolean, rows: IngestStateRow[]): ConnectionStatus {
  if (needsReauth) return "needs_reauth";
  if (rows.some((row) => row.status === "failed")) return "failed";
  if (rows.some((row) => row.status === "backfilling")) return "backfilling";
  return "active";
}

/** How many items the connection's current backfills have stored, across its apps. */
export function backfilledItems(rows: IngestStateRow[]): number {
  return rows.reduce((sum, row) => sum + row.backfilledItems, 0);
}

/** When polling last finished for any of the connection's apps. */
export function lastPolledAt(rows: IngestStateRow[]): Date | null {
  const times = rows.flatMap((row) => (row.lastPolledAt === null ? [] : [row.lastPolledAt]));
  return times.length === 0 ? null : new Date(Math.max(...times.map((time) => time.getTime())));
}
