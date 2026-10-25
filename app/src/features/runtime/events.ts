// The Inngest events runtime sends itself. A run is requested through the outbox, with the run's
// row (ADR-0027); the Calendar trigger's poll sends its invites from its own step. Definitions
// only, no IO: the outbox reads them to check what it sends.
import { eventType } from "inngest";
import { z } from "zod";

/**
 * A run was recorded and is due to execute. `connectionId` keys the per-connection limit. Its
 * event ID is `run-<run ID>`, so a run is executed once however often it's requested.
 */
export const runRequested = eventType("runtime/run.requested", {
  schema: z.object({
    orgId: z.string().min(1),
    runId: z.string().min(1),
    connectionId: z.string().min(1),
  }),
});

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

/** A connection's calendar is due a poll for new invites. */
export const calendarPollDue = eventType("runtime/calendar.poll-due", {
  schema: z.object({ orgId: z.string().min(1), connectionId: z.string().min(1) }),
});
