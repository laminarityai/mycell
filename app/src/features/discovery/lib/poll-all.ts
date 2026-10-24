// The sweep (ADR-0026): which connections the minute cron polls. A watched app's changes start
// its connection's poll as they happen, so the sweep only catches what a notification missed;
// an app without a live watch is still polled every minute. It runs before any ctx exists, so
// it lists the orgs and reads each one's connections as that org's system ctx (ADR-0009).
import { listConnectionsForJobs } from "@/features/connections/server";
import type { AppIngestState, ConnectionDetails } from "@/features/connections/types";
import { listOrgIds } from "@/features/orgs/server";
import { systemCtx } from "@/lib/ctx";
import type { ConnectionToPoll } from "../types";

/**
 * How long the sweep leaves an app with a live watch between polls. Once every ingested app
 * has a watch (Drive's, #147), nothing is due every minute and the cron itself can run every
 * 5 minutes.
 */
const SWEEP_WATCHED_EVERY_MS = 15 * 60 * 1000;

/**
 * Every connection in every org that's due a poll, with the org its poll acts in: one with no
 * reconnect pending and an `active` app that's due. The poll then polls all its active apps.
 */
export async function pollAllConnections(): Promise<ConnectionToPoll[]> {
  const now = Date.now();
  const due: ConnectionToPoll[] = [];
  for (const orgId of await listOrgIds()) {
    for (const connection of await listConnectionsForJobs(systemCtx(orgId))) {
      if (isDue(connection, now)) due.push({ orgId, connectionId: connection.id });
    }
  }
  return due;
}

function isDue(connection: ConnectionDetails, now: number): boolean {
  if (connection.needsReauth) return false;
  return Object.values(connection.ingest).some((state) => isAppDue(state, now));
}

// An active app is due every minute without a live watch (none started, or it lapsed), and
// with one once its last poll is SWEEP_WATCHED_EVERY_MS old, or it hasn't polled yet.
function isAppDue(state: AppIngestState, now: number): boolean {
  if (state.status !== "active") return false;
  const watched = state.watchExpiresAt !== null && state.watchExpiresAt.getTime() > now;
  if (!watched || state.lastPolledAt === null) return true;
  return now - state.lastPolledAt.getTime() >= SWEEP_WATCHED_EVERY_MS;
}
