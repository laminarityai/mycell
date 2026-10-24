// The "Try it" invite picker, for a workflow that starts on a new invite: the newest invites
// across the calendars the admin may try a spec on, their own and the org's, granted Calendar.
// Titles and organizers are fetched through the proxy for display only, every time, and never
// stored (invariant 8). Unlike the trigger's poll, it lists with filters and no sync token.
import { z } from "zod";
import { CALENDAR_EVENTS } from "@/features/connections/calendar";
import { buildableConnections, proxyGet } from "@/features/connections/server";
import { requireAdmin, type Ctx } from "@/lib/ctx";
import type { RecentMessages } from "../types";
import { newestAcross, RECENT_LIMIT, type Recent } from "./recent-messages";

// How far back the picker looks for changed events.
const RECENT_DAYS = 30;

const listSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        status: z.string().optional(),
        summary: z.string().default(""),
        created: z.string().optional(),
        eventType: z.string().optional(),
        organizer: z.object({ email: z.string().default(""), self: z.boolean().optional() }),
        attendees: z.array(z.object({ self: z.boolean().optional() })).default([]),
        start: z.object({ dateTime: z.string().optional(), date: z.string().optional() }),
      }),
    )
    .default([]),
});

/**
 * The picker's invites, grouped by connection: the newest RECENT_LIMIT of all of them, by when
 * each was made. With `credentials`, only the connections a spec with them could run on.
 */
export async function recentInvites(
  ctx: Ctx,
  credentials?: "member" | "org",
): Promise<RecentMessages[]> {
  requireAdmin(ctx);
  const tryable = await buildableConnections(ctx, credentials, "calendar");
  const fetched = await Promise.all(
    tryable.map(async (connection) => {
      try {
        return { connection, messages: await newest(ctx, connection.id), unavailable: false };
      } catch {
        // Calendar or Nango refused; the picker says so for this connection alone.
        return { connection, messages: [], unavailable: true };
      }
    }),
  );
  return newestAcross(fetched);
}

// The calendar's events changed lately that someone else invited the account to, newest made
// first. Answered or not: Try it may run on any invite.
async function newest(ctx: Ctx, connectionId: string): Promise<Recent[]> {
  const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    updatedMin: since.toISOString(),
    orderBy: "updated",
    maxResults: "250",
    fields:
      "items(id,status,summary,created,eventType,organizer(email,self),attendees(self),start)",
  });
  const found = await proxyGet(ctx, connectionId, `${CALENDAR_EVENTS}?${params}`, listSchema);
  return (found?.items ?? [])
    .flatMap((event) => {
      const invited = event.attendees.some((guest) => guest.self === true);
      if (!invited || event.organizer.self === true || event.created === undefined) return [];
      if (event.status === "cancelled" || event.eventType === "fromGmail") return [];
      return [
        {
          sourceRef: event.id,
          subject: event.summary,
          from: event.organizer.email,
          date: event.start.dateTime ?? event.start.date ?? "",
          receivedAt: Date.parse(event.created),
        },
      ];
    })
    .sort((a, b) => b.receivedAt - a.receivedAt)
    .slice(0, RECENT_LIMIT);
}
