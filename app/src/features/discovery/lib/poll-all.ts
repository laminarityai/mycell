// The polling cron's fan-out: which connections to poll this minute. It runs before any ctx
// exists, so it lists the orgs and reads each one's connections as that org's system ctx
// (ADR-0009).
import { listConnectionsForJobs } from "@/features/connections/server";
import { listOrgIds } from "@/features/orgs/server";
import { systemCtx } from "@/lib/ctx";
import type { ConnectionToPoll } from "../types";

/** Every `active` connection in every org, each with the org its poll acts in. */
export async function pollAllConnections(): Promise<ConnectionToPoll[]> {
  const due: ConnectionToPoll[] = [];
  for (const orgId of await listOrgIds()) {
    const connections = await listConnectionsForJobs(systemCtx(orgId));
    for (const connection of connections) {
      if (connection.status === "active") due.push({ orgId, connectionId: connection.id });
    }
  }
  return due;
}
