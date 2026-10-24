// The Inngest events runtime sends itself.
import { eventType } from "inngest";
import { z } from "zod";
import { inngest } from "@/lib/inngest";

/** A run was recorded and is due to execute. `connectionId` keys the per-connection limit. */
export const runRequested = eventType("runtime/run.requested", {
  schema: z.object({
    orgId: z.string().min(1),
    runId: z.string().min(1),
    connectionId: z.string().min(1),
  }),
});

/** Asks for the run to execute. The event ID makes a resend start no second execution. */
export async function sendRunRequested(data: z.infer<typeof runRequested.schema>) {
  await inngest.send(runRequested.create(data, { id: `run-${data.runId}` }));
}

/**
 * A new invite on a connection's calendar, found by the Calendar trigger's poll. Pointers only:
 * `sourceRef` is the event's ID on the connection's primary calendar, re-fetched by whatever
 * needs its content, and `occurredAt` is when the event was made.
 */
export const calendarInviteReceived = eventType("calendar/invite.received", {
  schema: z.object({
    orgId: z.string().min(1),
    connectionId: z.string().min(1),
    sourceRef: z.string().min(1),
    occurredAt: z.iso.datetime(),
  }),
});

export type CalendarInviteReceived = z.infer<typeof calendarInviteReceived.schema>;

/** Sends one event per invite. The event ID makes an invite sent again start nothing new. */
export async function sendInvitesReceived(invites: CalendarInviteReceived[]): Promise<void> {
  if (invites.length === 0) return;
  await inngest.send(
    invites.map((data) =>
      calendarInviteReceived.create(data, {
        id: `calendar-invite-${data.connectionId}-${data.sourceRef}`,
      }),
    ),
  );
}

/** A connection's calendar is due a poll for new invites. */
export const calendarPollDue = eventType("runtime/calendar.poll-due", {
  schema: z.object({ orgId: z.string().min(1), connectionId: z.string().min(1) }),
});
