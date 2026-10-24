// Reading and booking events on a connection's primary calendar through the Nango proxy, for the
// Calendar catalog actions. A booking is made once per run step: its event ID is derived from
// the step's marker, so a retry whose first answer was lost finds the event Google already made
// (409) rather than making a second. What's read is held in memory only (invariant 8).
import { createHash } from "node:crypto";
import { z } from "zod";
import { proxyGet, proxyPost } from "@/features/connections/server";
import { SourceRequestError } from "@/features/connections/types";
import type { Ctx } from "@/lib/ctx";
import { emailAddressesIn } from "@/lib/email-addresses";
import type { PendingDetails } from "../types";
import { CALENDAR_EVENTS } from "@/features/connections/calendar";
import { RunStepError } from "./failures";

const time = z.object({ dateTime: z.string().optional(), date: z.string().optional() });
const guestSchema = z.object({
  email: z.string().default(""),
  responseStatus: z.string().optional(),
  self: z.boolean().optional(),
  organizer: z.boolean().optional(),
});

/** An event as the Calendar actions and the review read it. */
export const calendarEventSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  summary: z.string().default(""),
  description: z.string().default(""),
  location: z.string().default(""),
  start: time.optional(),
  end: time.optional(),
  htmlLink: z.string().default(""),
  hangoutLink: z.string().optional(),
  visibility: z.string().optional(),
  transparency: z.string().optional(),
  organizer: z.object({ email: z.string().default("") }).optional(),
  attendees: z.array(guestSchema).default([]),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;
export type EventGuest = z.infer<typeof guestSchema>;

/** The path of one event on the primary calendar. */
export function eventPath(eventId: string): string {
  return `${CALENDAR_EVENTS}/${encodeURIComponent(eventId)}`;
}

/**
 * The event as it is now, or null when it's gone: never there, deleted (Google answers 404 or
 * 410), or kept as `cancelled`.
 */
export async function liveEvent(
  ctx: Ctx,
  connectionId: string,
  eventId: string,
): Promise<CalendarEvent | null> {
  const event = await proxyGet(ctx, connectionId, eventPath(eventId), calendarEventSchema);
  return event === null || event.status === "cancelled" ? null : event;
}

/** A start or end as the event gives it: a time, or a date for an all-day event. */
export function whenOf(at: CalendarEvent["start"]): string {
  return at?.dateTime ?? at?.date ?? "";
}

/** The event's guests other than the person whose calendar it is. */
export function otherGuests(event: CalendarEvent): EventGuest[] {
  return event.attendees.filter((guest) => guest.self !== true && guest.organizer !== true);
}

/** The read-event action: the event's details, which pass to later steps, never to records. */
export async function readEvent(ctx: Ctx, connectionId: string, input: { eventId: string }) {
  const event = await liveEvent(ctx, connectionId, input.eventId);
  if (event === null) {
    throw new RunStepError("source_item_missing", "The event is no longer on the calendar.");
  }
  const guests = otherGuests(event).map((guest) => guest.email);
  return {
    eventId: event.id,
    title: event.summary,
    description: event.description,
    start: whenOf(event.start),
    end: whenOf(event.end),
    location: event.location,
    organizer: event.organizer?.email ?? "",
    guests,
    guestCount: guests.length,
  };
}

/** What a create-event step asks for, once its input passed the catalog's schema. */
export type Booking = {
  title: string;
  description?: string;
  start: string;
  end: string;
  timeZone?: string;
  location?: string;
  guests: string[];
  meet: boolean;
  visibility: PendingDetails["visibility"];
  transparency: PendingDetails["transparency"];
};

/** The guests' addresses, lowercased, each once, from entries that may carry a name too. */
export function guestAddresses(guests: readonly string[]): string[] {
  return emailAddressesIn(guests.join("\n"));
}

/** The event ID a run step's booking gets: base32hex, as Calendar takes a client's own ID. */
export function bookedEventId(marker: string): string {
  return createHash("sha256").update(`mycel-booking/${marker}`).digest("hex");
}

const eventRef = z.object({ id: z.string() });

/**
 * Books the event on the primary calendar, once per run step (`marker`): with no guests,
 * private and not blocking time, notifying nobody (ADR-0013), and with a Meet link only when the
 * step asks. A retry finds the event an earlier try made. Returns its ID and what approving it
 * will need: the guests, and how it shows once approved.
 */
export async function bookEvent(
  ctx: Ctx,
  connectionId: string,
  booking: Booking,
  marker: string,
): Promise<{ eventId: string; details: PendingDetails }> {
  const id = bookedEventId(marker);
  const params = new URLSearchParams({ sendUpdates: "none" });
  if (booking.meet) params.set("conferenceDataVersion", "1");
  const body = {
    id,
    summary: booking.title,
    ...(booking.description === undefined ? {} : { description: booking.description }),
    ...(booking.location === undefined ? {} : { location: booking.location }),
    start: timeOf(booking.start, booking.timeZone),
    end: timeOf(booking.end, booking.timeZone),
    visibility: "private",
    transparency: "transparent",
    ...(booking.meet
      ? {
          conferenceData: {
            createRequest: { requestId: id, conferenceSolutionKey: { type: "hangoutsMeet" } },
          },
        }
      : {}),
  };
  try {
    const made = await proxyPost(ctx, connectionId, `${CALENDAR_EVENTS}?${params}`, body, eventRef);
    if (made === null) {
      throw new RunStepError("source_item_missing", "The calendar is no longer there.");
    }
  } catch (error) {
    if (!(error instanceof SourceRequestError) || error.status !== 409) throw error;
    // An earlier try made it and its answer was lost.
    if ((await liveEvent(ctx, connectionId, id)) === null) {
      throw new RunStepError("source_item_missing", "The event this step booked was deleted.");
    }
  }
  const details: PendingDetails = {
    kind: "calendar_event",
    guests: guestAddresses(booking.guests),
    visibility: booking.visibility,
    transparency: booking.transparency,
  };
  return { eventId: id, details };
}

function timeOf(dateTime: string, timeZone: string | undefined) {
  return timeZone === undefined ? { dateTime } : { dateTime, timeZone };
}
