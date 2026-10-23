// Watches (ADR-0026): a standing request that an app tell Mycel when something changes in one
// connection's account. A watch starts when an app's backfill finishes, and the daily renewal
// renews every active one, restarting any that lapsed, failed or never started. Its expiry is
// stored on the app's ingest state, which cascades with the connection, and a watch is never
// stopped: a deleted connection's runs out on its own. Without push configured, no watch starts.
import {
  listConnectionsForJobs,
  recordIngestState,
  sourceClient,
} from "@/features/connections/server";
import { ingestedAppSchema, type IngestedApp } from "@/features/connections/types";
import { requireSystem, type Ctx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import { gmailPushConfig } from "./gmail-push";
import { CONNECTORS } from "./ingest-steps";

/** Whether `app` gets a watch here: its connector can watch, and push is configured. */
export function watches(app: IngestedApp): boolean {
  return CONNECTORS[app].watch !== undefined && gmailPushConfig() !== null;
}

/**
 * Starts or renews `app`'s watch on the connection and records when it runs out. Returns that
 * expiry, or null when no watch started: the app can't watch here, or the call failed (logged),
 * which leaves the app to polling and any expiry stored before as it was. NotFoundError if the
 * connection is gone.
 */
export async function startWatch(
  ctx: Ctx,
  connectionId: string,
  app: IngestedApp,
): Promise<Date | null> {
  const connector = CONNECTORS[app];
  const push = gmailPushConfig();
  if (push === null || connector.watch === undefined) return null;
  try {
    const client = await sourceClient(ctx, connectionId);
    const expiresAt = await connector.watch(client, push);
    await recordIngestState(ctx, connectionId, app, { watchExpiresAt: expiresAt });
    return expiresAt;
  } catch (error) {
    if (error instanceof NotFoundError) throw error;
    console.warn(
      `Couldn't start the ${app} watch on connection ${connectionId}; it stays polled.`,
      error,
    );
    return null;
  }
}

/**
 * Renews the watch of every `active` app that can watch, on each of the org's connections that
 * needs no reconnect, which also restarts one that lapsed or never started. A failed renewal is
 * logged and the rest go on. For the renew-watches cron, as the org's system ctx (ADR-0009);
 * anyone else is ForbiddenError.
 */
export async function renewWatches(ctx: Ctx): Promise<{ renewed: number; failed: number }> {
  requireSystem(ctx);
  const result = { renewed: 0, failed: 0 };
  const apps = ingestedAppSchema.options.filter(watches);
  if (apps.length === 0) return result;
  for (const connection of await listConnectionsForJobs(ctx)) {
    if (connection.needsReauth) continue;
    for (const app of apps) {
      if (connection.ingest[app]?.status !== "active") continue;
      const renewed = await unlessGone(startWatch(ctx, connection.id, app));
      if (renewed === undefined) break;
      result[renewed === null ? "failed" : "renewed"] += 1;
    }
  }
  return result;
}

// A connection deleted while the renewal runs is skipped: undefined.
async function unlessGone<T>(work: Promise<T>): Promise<T | undefined> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof NotFoundError) return undefined;
    throw error;
  }
}
