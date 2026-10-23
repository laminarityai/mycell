// Watches (ADR-0026): a standing request that an app tell Mycel when something changes in one
// connection's account. A watch starts when an app's backfill finishes, and the daily renewal
// renews every active one, restarting any that lapsed, failed or never started. Its expiry (and,
// for a web-hook channel like Drive's, the channel) is stored on the app's ingest state, which
// cascades with the connection. A channel is stopped only once its replacement is open; a
// deleted connection's watch runs out on its own. Without an app's push settings, it has none.
import {
  getConnection,
  listConnectionsForJobs,
  recordIngestState,
  sourceClient,
} from "@/features/connections/server";
import {
  ingestedAppSchema,
  type AppIngestState,
  type IngestedApp,
} from "@/features/connections/types";
import { requireSystem, type Ctx } from "@/lib/ctx";
import { NotFoundError } from "@/lib/errors";
import type { SourceClient, WatchChannel, Watcher } from "./connector";
import { CONNECTORS } from "./ingest-steps";

/** Whether `app` gets a watch here: its connector can watch, and its push is configured. */
export function watches(app: IngestedApp): boolean {
  return CONNECTORS[app].watch?.configured() === true;
}

/**
 * Starts or renews `app`'s watch on the connection and records when it runs out. Returns that
 * expiry, or null when no watch started: the app can't watch here, or the call failed (logged),
 * which leaves the app to polling and any watch stored before as it was. NotFoundError if the
 * connection is gone.
 */
export async function startWatch(
  ctx: Ctx,
  connectionId: string,
  app: IngestedApp,
): Promise<Date | null> {
  if (!watches(app)) return null;
  const state = (await getConnection(ctx, connectionId)).ingest[app];
  if (state === undefined) throw new NotFoundError("connection");
  return watchApp(ctx, connectionId, app, state);
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
      const state = connection.ingest[app];
      if (state?.status !== "active") continue;
      const renewed = await unlessGone(watchApp(ctx, connection.id, app, state));
      if (renewed === undefined) break;
      result[renewed === null ? "failed" : "renewed"] += 1;
    }
  }
  return result;
}

// Starts the app's watch from its stored state, records it, and then stops the channel it
// replaces, if any.
async function watchApp(
  ctx: Ctx,
  connectionId: string,
  app: IngestedApp,
  state: AppIngestState,
): Promise<Date | null> {
  const watcher = CONNECTORS[app].watch;
  if (watcher === undefined) return null;
  try {
    const client = await sourceClient(ctx, connectionId);
    const target = { orgId: ctx.orgId, connectionId, cursor: state.cursor };
    const { expiresAt, channel } = await watcher.start(client, target);
    await recordIngestState(ctx, connectionId, app, {
      watchExpiresAt: expiresAt,
      ...(channel === null
        ? {}
        : { watchChannelId: channel.id, watchResourceId: channel.resourceId }),
    });
    await stopReplaced(watcher, client, connectionId, app, replacedChannel(state, channel));
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

// The channel the state recorded, unless it's the one just opened.
function replacedChannel(state: AppIngestState, opened: WatchChannel | null): WatchChannel | null {
  if (state.watchChannelId === null || state.watchResourceId === null) return null;
  if (state.watchChannelId === opened?.id) return null;
  return { id: state.watchChannelId, resourceId: state.watchResourceId };
}

// Stops a replaced channel. A failure is logged, and the channel runs out on its own.
async function stopReplaced(
  watcher: Watcher,
  client: SourceClient,
  connectionId: string,
  app: IngestedApp,
  channel: WatchChannel | null,
): Promise<void> {
  if (channel === null || watcher.stop === undefined) return;
  try {
    await watcher.stop(client, channel);
  } catch (error) {
    console.warn(
      `Couldn't stop the replaced ${app} channel on connection ${connectionId}; it runs out on its own.`,
      error,
    );
  }
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
