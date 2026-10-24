// Reading one Calendar invite to learn from, through the Nango proxy: an event with guests on the
// connection's primary calendar (events.get), at the version a `source_ref` names. What it
// returns holds the invite's title and description: in memory only, never stored, returned from a
// step or put in an error (invariant 8). Only its pointers, item key and the addresses on it are
// stored. Who may see it is read on its own too, when it may have changed.
//
// Its access list is only what Mycel saw (ADR-0023, ADR-0029), as an email's is: the calendar
// holding the copy and, for an event the calendar's own account organised (only its owner can
// cause that), everyone on it too: the company's own organizer chose them. Anyone else on an
// invite someone else organised counts once their own connected calendar holds a copy (the
// visibility rule for held copies), since its organizer wrote that list. The rest are kept
// unconfirmed, for exclusions only.
import { z } from "zod";
import { CALENDAR_EVENTS } from "@/features/connections/calendar";
import type { SourceClient } from "@/features/connections/types";
import type { AccessEntry, SourceItem } from "./source-item";

// How much of a description the models read: an agenda and its notes, short of a pasted thread.
const MAX_DESCRIPTION_CHARS = 8_000;

/** About the most text of one invite a model reads: its description, and its other fields. */
export const MAX_INVITE_CHARS = MAX_DESCRIPTION_CHARS + 2_000;

// What reading an invite reads of the event: never its attachments or conference details.
const INVITE_FIELDS =
  "id,status,sequence,updated,iCalUID,recurringEventId,originalStartTime,eventType,summary," +
  "description,location,start,end,organizer(email,self),attendees(email,self,resource)";

// What reading who may see it reads.
const ACCESS_FIELDS = "status,organizer(email,self),attendees(email,self,resource)";

const time = z.object({ dateTime: z.string().optional(), date: z.string().optional() });

const people = {
  organizer: z.object({ email: z.string().default(""), self: z.boolean().optional() }).optional(),
  attendees: z
    .array(
      z.object({
        email: z.string().default(""),
        self: z.boolean().optional(),
        // A room or other resource, not a person.
        resource: z.boolean().optional(),
      }),
    )
    .default([]),
};

const accessSchema = z.object({ status: z.string().optional(), ...people });

const eventSchema = accessSchema.extend({
  id: z.string().min(1),
  sequence: z.number().int().nonnegative().default(0),
  updated: z.string(),
  iCalUID: z.string().min(1),
  recurringEventId: z.string().optional(),
  originalStartTime: time.optional(),
  eventType: z.string().optional(),
  summary: z.string().default(""),
  description: z.string().default(""),
  location: z.string().default(""),
  start: time.optional(),
  end: time.optional(),
});

/** The event and version a Calendar `source_ref` names: `<event ID>@<sequence>`. */
export function calendarVersion(sourceRef: string): { eventId: string; sequence: number } {
  const at = sourceRef.lastIndexOf("@");
  return { eventId: sourceRef.slice(0, at), sequence: Number(sourceRef.slice(at + 1)) };
}

/**
 * The invite at the version `sourceRef` names, or why not: `gone` (deleted, cancelled or no
 * longer on the calendar), `unsupported` (not an ordinary event, or one with no guests: nobody
 * was invited), or `outdated` (its organizer has changed it since, and its newer version is
 * learned on its own).
 *
 * Its item key is its iCalUID, the same on every calendar it's on, with the time an instance of a
 * recurring event was first set for, since every instance shares the series' iCalUID. `addresses`
 * are its organizer and guests (rooms aside), `senders` its organizer, and `text` its title,
 * people, times, place and description.
 */
export async function readInvite(
  source: SourceClient,
  sourceRef: string,
): Promise<SourceItem | "gone" | "unsupported" | "outdated"> {
  const { eventId, sequence } = calendarVersion(sourceRef);
  const event = await source.get(eventPath(eventId, INVITE_FIELDS), eventSchema);
  if (event === null || event.status === "cancelled") return "gone";
  if (event.eventType !== undefined && event.eventType !== "default") return "unsupported";
  const { access, addresses, organizedHere, holder } = accessOf(source, event);
  // No one but the calendar's own account is on it: nobody was invited.
  if (addresses.every((address) => address === holder)) return "unsupported";
  if (event.sequence !== sequence) return "outdated";
  const instance = event.originalStartTime;
  const when = (at: z.infer<typeof time> | undefined) => at?.dateTime ?? at?.date ?? "";
  const guests = event.attendees.filter((guest) => guest.resource !== true);
  const description = event.description.slice(0, MAX_DESCRIPTION_CHARS);
  return {
    kind: "invite",
    sourceRef,
    itemKey:
      event.recurringEventId === undefined || instance === undefined
        ? event.iCalUID
        : `${event.iCalUID}@${when(instance)}`,
    occurredAt: new Date(event.updated),
    access,
    addresses,
    fromInside: organizedHere,
    senders: event.organizer?.email ? [event.organizer.email.toLowerCase()] : [],
    text: [
      `Title: ${event.summary}`,
      `Organizer: ${event.organizer?.email ?? ""}`,
      `Guests: ${guests.map((guest) => guest.email).join(", ")}`,
      `Starts: ${when(event.start)}`,
      `Ends: ${when(event.end)}`,
      ...(event.location === "" ? [] : [`Location: ${event.location}`]),
      "",
      description,
    ].join("\n"),
  };
}

/**
 * Who may see the event as the connection's calendar shows it now (its access list, and every
 * address on it, for exclusions), or `gone` when it's deleted, cancelled or no longer on the
 * calendar.
 */
export async function readInviteAccess(
  source: SourceClient,
  eventId: string,
): Promise<{ access: AccessEntry[]; addresses: string[] } | "gone"> {
  const event = await source.get(eventPath(eventId, ACCESS_FIELDS), accessSchema);
  if (event === null || event.status === "cancelled") return "gone";
  const { access, addresses } = accessOf(source, event);
  return { access, addresses };
}

function eventPath(eventId: string, fields: string): string {
  return `${CALENDAR_EVENTS}/${encodeURIComponent(eventId)}?${new URLSearchParams({ fields }).toString()}`;
}

// The calendar holding the copy, and, for an event its own account organised, everyone on it.
function accessOf(source: SourceClient, event: z.infer<typeof accessSchema>) {
  const holder = source.connection.accountEmail.trim().toLowerCase();
  const organizedHere = event.organizer?.self === true;
  const addresses = [
    ...new Set(
      [
        event.organizer?.email ?? "",
        ...event.attendees.filter((guest) => guest.resource !== true).map((guest) => guest.email),
      ]
        .map((address) => address.trim().toLowerCase())
        .filter((address) => address !== ""),
    ),
  ];
  const confirmed = [...new Set([holder, ...(organizedHere ? addresses : [])])];
  const access: AccessEntry[] = confirmed.map((value) => ({ kind: "address", value }));
  return { access, addresses, organizedHere, holder };
}
