// The Calendar poll's cron fan-out: which calendars to poll this minute. It runs before any ctx
// exists, so it lists the orgs and reads each one's connections as that org's system ctx
// (ADR-0009).
import { listConnectionsForJobs } from "@/features/connections/server";
import { hasMemoryStarted } from "@/features/memory/server";
import { listOrgIds } from "@/features/orgs/server";
import { listStartable } from "@/features/workflows/server";
import { type Ctx, systemCtx } from "@/lib/ctx";

/**
 * Every connection, in every org, granted Calendar, with no reconnect pending, and either with a
 * Calendar-triggered workflow switched on for it that may start runs, or in an org where memory
 * has started (memory learns from every calendar, ADR-0029), each with its org.
 */
export async function calendarsDue(): Promise<{ orgId: string; connectionId: string }[]> {
  const due: { orgId: string; connectionId: string }[] = [];
  for (const orgId of await listOrgIds()) {
    const ctx = systemCtx(orgId);
    const memory = await hasMemoryStarted(ctx);
    for (const connection of await listConnectionsForJobs(ctx)) {
      if (connection.needsReauth || !connection.apps.includes("calendar")) continue;
      if (memory || (await triggersOn(ctx, connection.id))) {
        due.push({ orgId, connectionId: connection.id });
      }
    }
  }
  return due;
}

// Whether a Calendar-triggered workflow that may start runs is switched on for the connection.
async function triggersOn(ctx: Ctx, connectionId: string): Promise<boolean> {
  const switches = await listStartable(ctx, connectionId);
  return switches.some((on) => on.trigger.type === "calendar.invite_received");
}
