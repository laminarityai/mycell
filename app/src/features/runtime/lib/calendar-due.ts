// The Calendar trigger's cron fan-out: which calendars to poll this minute. It runs before any
// ctx exists, so it lists the orgs and reads each one's connections as that org's system ctx
// (ADR-0009).
import { listConnectionsForJobs } from "@/features/connections/server";
import { listOrgIds } from "@/features/orgs/server";
import { listStartable } from "@/features/workflows/server";
import { systemCtx } from "@/lib/ctx";

/**
 * Every connection, in every org, granted Calendar, with no reconnect pending, and with a
 * Calendar-triggered workflow switched on for it that may start runs, each with its org.
 */
export async function calendarsDue(): Promise<{ orgId: string; connectionId: string }[]> {
  const due: { orgId: string; connectionId: string }[] = [];
  for (const orgId of await listOrgIds()) {
    const ctx = systemCtx(orgId);
    for (const connection of await listConnectionsForJobs(ctx)) {
      if (connection.needsReauth || !connection.apps.includes("calendar")) continue;
      const switches = await listStartable(ctx, connection.id);
      if (switches.some((on) => on.trigger.type === "calendar.invite_received")) {
        due.push({ orgId, connectionId: connection.id });
      }
    }
  }
  return due;
}
