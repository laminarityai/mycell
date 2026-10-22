// Reading a connection's primary calendar through the Nango proxy, for the Calendar trigger:
// listing what changed since a sync token, and reading one invite live, for a step to test its
// facts or a model to read it. What's read is held in memory only (invariant 8).
import { z } from "zod";
import { proxyGet } from "@/features/connections/server";
import type { Ctx } from "@/lib/ctx";
import { RunStepError } from "./failures";

/** The connection's primary calendar's events (Calendar API v3). */
export const CALENDAR_EVENTS = "/calendar/v3/calendars/primary/events";

/**
 * What every list request asks, the first included: Google refuses a sync token whose request
 * asked anything else, and one combined with timeMin, timeMax, updatedMin, q or orderBy. The
 * fields are what tells an invite apart, and none of its content.
 */
const LIST_PARAMS = {
  maxResults: "250",
  fields:
    "nextPageToken,nextSyncToken,items(id,status,created,eventType,attendeesOmitted," +
    "organizer(self),attendees(self,responseStatus))",
};

const listedEvent = z.object({
  id: z.string().min(1),
  status: z.string().optional(),
  // A deletion listed to a sync token carries little more than its ID.
  created: z.string().optional(),
  eventType: z.string().optional(),
  attendeesOmitted: z.boolean().optional(),
  organizer: z.object({ self: z.boolean().optional() }).optional(),
  attendees: z
    .array(z.object({ self: z.boolean().optional(), responseStatus: z.string().optional() }))
    .optional(),
});
type ListedEvent = z.infer<typeof listedEvent>;

const eventsPage = z.object({
  items: z.array(listedEvent).default([]),
  nextPageToken: z.string().optional(),
  nextSyncToken: z.string().optional(),
});

/** One page of a listing: the new invites on it, and where the listing goes on or resumes. */
export type CalendarPage = {
  invites: { eventId: string; createdAt: string }[];
  nextPageToken: string | null;
  nextSyncToken: string | null;
};

/**
 * One page of the calendar's events: from the start (a full sync), what changed since
 * `syncToken`, or the page `pageToken` names. Null when Google no longer accepts the token
 * (410): the caller starts over with a full sync.
 */
export async function listCalendarPage(
  ctx: Ctx,
  connectionId: string,
  from: { syncToken?: string; pageToken?: string },
): Promise<CalendarPage | null> {
  const params = new URLSearchParams(LIST_PARAMS);
  if (from.syncToken !== undefined) params.set("syncToken", from.syncToken);
  if (from.pageToken !== undefined) params.set("pageToken", from.pageToken);
  const page = await proxyGet(ctx, connectionId, `${CALENDAR_EVENTS}?${params}`, eventsPage);
  if (page === null) return null;
  return {
    invites: page.items.flatMap((event) =>
      isNewInvite(event) && event.created !== undefined
        ? [{ eventId: event.id, createdAt: event.created }]
        : [],
    ),
    nextPageToken: page.nextPageToken ?? null,
    nextSyncToken: page.nextSyncToken ?? null,
  };
}

/**
 * An invite the person hasn't answered: their own guest entry says `needsAction`. Not one they
 * organised, one cancelled (a deletion, to a sync token), one Gmail added from an email, or one
 * whose guests Google left out, since it can't say whose entry is theirs.
 */
function isNewInvite(event: ListedEvent): boolean {
  if (event.status === "cancelled" || event.eventType === "fromGmail") return false;
  if (event.attendeesOmitted === true || event.organizer?.self === true) return false;
  return (event.attendees ?? []).some(
    (guest) => guest.self === true && guest.responseStatus === "needsAction",
  );
}

const inviteSchema = z.object({
  status: z.string().optional(),
  summary: z.string().default(""),
  description: z.string().default(""),
  location: z.string().default(""),
  start: z.object({ dateTime: z.string().optional(), date: z.string().optional() }).optional(),
  end: z.object({ dateTime: z.string().optional(), date: z.string().optional() }).optional(),
  organizer: z.object({ email: z.string().default("") }).optional(),
  attendees: z.array(z.object({ email: z.string().default("") })).default([]),
});
type Invite = z.infer<typeof inviteSchema>;

const INVITE_FIELDS =
  "status,summary,description,location,start,end,organizer(email),attendees(email)";

// The invite as it is now. A step on an invite that's gone (deleted, or cancelled) fails.
async function readInvite(ctx: Ctx, connectionId: string, eventId: string): Promise<Invite> {
  const path = `${CALENDAR_EVENTS}/${encodeURIComponent(eventId)}?fields=${INVITE_FIELDS}`;
  const invite = await proxyGet(ctx, connectionId, path, inviteSchema);
  if (invite === null || invite.status === "cancelled") {
    throw new RunStepError("source_item_missing", "The invite is no longer on the calendar.");
  }
  return invite;
}

/** The invite's facts a branch may test (`spec/triggers.ts`), held in memory by the caller. */
export async function inviteFacts(
  ctx: Ctx,
  connectionId: string,
  eventId: string,
): Promise<Record<string, string>> {
  const invite = await readInvite(ctx, connectionId, eventId);
  const organizer = invite.organizer?.email.toLowerCase() ?? "";
  return {
    organizer,
    organizerDomain: organizer.slice(organizer.indexOf("@") + 1),
    title: invite.summary,
  };
}

/** The invite as a model reads it: when, who, and what it says. */
export async function inviteText(ctx: Ctx, connectionId: string, eventId: string): Promise<string> {
  const invite = await readInvite(ctx, connectionId, eventId);
  const when = (time: Invite["start"]) => time?.dateTime ?? time?.date ?? "";
  return [
    `Title: ${invite.summary}`,
    `Organizer: ${invite.organizer?.email ?? ""}`,
    `Guests: ${invite.attendees.map((guest) => guest.email).join(", ")}`,
    `Starts: ${when(invite.start)}`,
    `Ends: ${when(invite.end)}`,
    ...(invite.location === "" ? [] : [`Location: ${invite.location}`]),
    "",
    invite.description,
  ].join("\n");
}
