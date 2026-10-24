// The Calendar events adapter (ADR-0013): a booked meeting waits on the person's own calendar as
// an event with no guests, private and not blocking time, so nobody is invited and colleagues'
// "find a time" isn't blocked until a person approves it. Approving adds the guests the review
// keeps and sends the invitations, and sets how the event shows to what the step asked; declining
// deletes the event. The person may also add the guests in Calendar themselves (done in the app)
// or delete the event (gone). The event's title and description are read live, held in memory
// only (invariant 8).
import { z } from "zod";
import { proxyDelete, proxyPatch } from "@/features/connections/server";
import type { Ctx } from "@/lib/ctx";
import { InvariantError, ItemGoneError, ValidationError } from "@/lib/errors";
import type { PendingDetails } from "../types";
import {
  bookEvent,
  eventPath,
  liveEvent,
  otherGuests,
  whenOf,
  type Booking,
  type CalendarEvent,
} from "./calendar-events";
import type { PendingFormAdapter, PendingItem } from "./pending-forms";

/** What the create-event action hands `prepare`: the booking, and the run step making it. */
export type BookingInput = {
  connectionId: string;
  /** The run and step making it (`<runId>/<stepId>`), so a retry finds its earlier event. */
  marker: string;
  booking: Booking;
};

const eventRef = z.object({ id: z.string() });

export const calendarEventAdapter: PendingFormAdapter<BookingInput> = {
  // The event, booked once per run step with no guests; the review keeps the guests.
  async prepare(ctx, { connectionId, marker, booking }) {
    const { eventId, details } = await bookEvent(ctx, connectionId, booking, marker);
    return { itemRef: eventId, threadRef: eventId, details };
  },

  // Adds the guests the event doesn't have yet, inviting them, and shows the event as the step
  // asked. A retry after a lost answer finds them there already and invites nobody again.
  async approve(ctx, item, edits) {
    if (edits !== undefined) {
      throw new ValidationError("A meeting is approved as it is; change it in Calendar first.");
    }
    const details = detailsOf(item);
    const event = await eventOf(ctx, item);
    const invited = new Set(event.attendees.map((guest) => guest.email.toLowerCase()));
    const missing = details.guests.filter((guest) => !invited.has(guest));
    const shows = { visibility: details.visibility, transparency: details.transparency };
    if (missing.length > 0) {
      const attendees = [
        ...event.attendees.map(({ email, responseStatus }) => ({ email, responseStatus })),
        ...missing.map((email) => ({ email })),
      ];
      await patch(ctx, item, "all", { attendees, ...shows });
    } else if (!showsAs(event, details)) {
      await patch(ctx, item, "none", shows);
    }
  },

  // Deletes the event. Guests someone added meanwhile are told it's cancelled.
  async decline(ctx, item) {
    const event = await eventOf(ctx, item);
    const sendUpdates = otherGuests(event).length > 0 ? "all" : "none";
    const path = `${eventPath(item.itemRef)}?sendUpdates=${sendUpdates}`;
    if (!(await proxyDelete(ctx, item.connectionId, path))) throw new ItemGoneError();
  },

  // Guests on it means the person invited them in Calendar (or an earlier approval did); no
  // event means it was deleted.
  async check(ctx, item) {
    const event = await liveEvent(ctx, item.connectionId, item.itemRef);
    if (event === null) return "gone";
    return otherGuests(event).length > 0 ? "done_in_app" : "waiting";
  },

  // The event as it is now, with the guests approving invites.
  async view(ctx, item) {
    const details = detailsOf(item);
    const event = await eventOf(ctx, item);
    return {
      kind: "event",
      title: event.summary,
      description: event.description,
      start: whenOf(event.start),
      end: whenOf(event.end),
      location: event.location,
      link: event.htmlLink,
      meetLink: event.hangoutLink ?? null,
      guests: details.guests,
      visibility: details.visibility,
      transparency: details.transparency,
    };
  },
};

function detailsOf(item: PendingItem): PendingDetails {
  if (item.details?.kind !== "calendar_event") {
    throw new InvariantError("A meeting's review keeps no guests.");
  }
  return item.details;
}

async function eventOf(ctx: Ctx, item: PendingItem): Promise<CalendarEvent> {
  const event = await liveEvent(ctx, item.connectionId, item.itemRef);
  if (event === null) throw new ItemGoneError();
  return event;
}

// Whether the event already shows as approving it would make it.
function showsAs(event: CalendarEvent, details: PendingDetails): boolean {
  const visibility = event.visibility ?? "default";
  const transparency = event.transparency ?? "opaque";
  return visibility === details.visibility && transparency === details.transparency;
}

async function patch(
  ctx: Ctx,
  item: PendingItem,
  sendUpdates: "all" | "none",
  body: Record<string, unknown>,
): Promise<void> {
  const path = `${eventPath(item.itemRef)}?sendUpdates=${sendUpdates}`;
  const patched = await proxyPatch(ctx, item.connectionId, path, body, eventRef);
  if (patched === null) throw new ItemGoneError();
}
