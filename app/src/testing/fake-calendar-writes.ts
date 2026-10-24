// The fake Calendar's writes, in the shapes Google documents
// (https://developers.google.com/workspace/calendar/api/v3/reference/events): events.insert,
// events.patch, events.update and events.delete on the primary calendar. Like Google, it takes a
// client-chosen event ID only in base32hex (5 to 1024 of a-v and 0-9) and answers 409 to one the
// calendar already has, deleted events included; it refuses a missing or empty time range, an
// unknown visibility, transparency or `sendUpdates`, and a guest without an address; it makes a
// Meet link only when the request sends `conferenceDataVersion=1` with a `createRequest` (and
// ignores conference data otherwise); a patch's arrays replace the event's; and deleting an
// event leaves it `cancelled`, so deleting it again answers 410. It logs every write it makes,
// with the guests Google emailed for it, and can lose a write's answer after making it.
import { createHash } from "node:crypto";
import { HttpResponse } from "msw";
import { z } from "zod";
import {
  calendarError,
  eventId as newEventId,
  PRIMARY_EVENTS,
  type FakeCalendar,
} from "./fake-calendar";
import type { Attendee, CalendarEventResource, CalendarWrite } from "./fake-calendar-events";
import type { WriteMethod } from "./fake-proxied-sources";

const ID = /^[a-v0-9]{5,1024}$/;
const time = z.object({ dateTime: z.string(), timeZone: z.string().optional() });
const attendee = z.object({
  email: z.email(),
  responseStatus: z.enum(["needsAction", "declined", "tentative", "accepted"]).optional(),
  self: z.boolean().optional(),
  organizer: z.boolean().optional(),
});
const eventBody = z.object({
  id: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: time.optional(),
  end: time.optional(),
  visibility: z.enum(["default", "public", "private", "confidential"]).optional(),
  transparency: z.enum(["opaque", "transparent"]).optional(),
  attendees: z.array(attendee).optional(),
  conferenceData: z
    .object({
      createRequest: z
        .object({
          requestId: z.string().min(1),
          conferenceSolutionKey: z.object({ type: z.literal("hangoutsMeet") }),
        })
        .optional(),
    })
    .optional(),
});
type EventBody = z.infer<typeof eventBody>;

type Request = {
  /** The event the path names; none for an insert. */
  id: string | undefined;
  params: URLSearchParams;
  body: unknown;
  method: WriteMethod;
};

// A write to the Calendar API behind the proxy, made on the connection's calendar.
export function calendarWriteResponse(
  calendar: FakeCalendar,
  path: string,
  params: URLSearchParams,
  body: unknown,
  method: WriteMethod,
): Response {
  if (!path.startsWith(PRIMARY_EVENTS)) throw new Error(`The fake Calendar doesn't serve ${path}`);
  const rest = path.slice(PRIMARY_EVENTS.length);
  const id = rest === "" ? undefined : decodeURIComponent(rest.slice(1));
  return calendarWrite(calendar, { id, params, body, method });
}

/** A write to the primary calendar's events, answered as Google answers it. */
function calendarWrite(calendar: FakeCalendar, request: Request): Response {
  const answer = write(calendar, request);
  if (answer.ok && calendar.writes.takeLostAnswer()) {
    return calendarError(503, "backendError", "Backend Error");
  }
  return answer;
}

function write(calendar: FakeCalendar, { id, params, body, method }: Request): Response {
  const sendUpdates = params.get("sendUpdates");
  if (sendUpdates !== null && !["all", "externalOnly", "none"].includes(sendUpdates)) {
    return invalid(`Invalid value for: sendUpdates`);
  }
  const version = params.get("conferenceDataVersion");
  if (version !== null && version !== "0" && version !== "1") {
    return invalid("Invalid value for: conferenceDataVersion");
  }
  if (method === "POST" && id === undefined) return insert(calendar, params, body);
  if (id === undefined) throw new Error(`The fake Calendar takes no ${method} on the events list`);
  const event = calendar.find(id);
  if (event === undefined) return calendarError(404, "notFound", "Not Found");
  if (event.status === "cancelled")
    return calendarError(410, "deleted", "Resource has been deleted");
  if (method === "DELETE") {
    const notified = notifiedOf(calendar, event, sendUpdates);
    calendar.cancel(id);
    logWrite(calendar, "delete", id, params, notified);
    return new HttpResponse(null, { status: 204 });
  }
  if (method !== "PATCH" && method !== "PUT") {
    throw new Error(`The fake Calendar takes no ${method} on an event`);
  }
  const parsed = eventBody.safeParse(body);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Invalid request");
  const changed = method === "PUT" ? replaced(event, parsed.data) : patched(event, parsed.data);
  const problem = timeProblem(changed);
  if (problem !== undefined) return problem;
  withConference(changed, parsed.data, version);
  changed.updated = new Date().toISOString();
  calendar.save(changed);
  const call = method === "PUT" ? "update" : "patch";
  logWrite(calendar, call, id, params, notifiedOf(calendar, changed, sendUpdates));
  return HttpResponse.json(changed);
}

function insert(calendar: FakeCalendar, params: URLSearchParams, body: unknown): Response {
  const parsed = eventBody.safeParse(body);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? "Invalid request");
  const input = parsed.data;
  if (input.id !== undefined && !ID.test(input.id)) return invalid("Invalid resource id value.");
  const id = input.id ?? newEventId();
  if (calendar.find(id) !== undefined) {
    return calendarError(409, "duplicate", "The requested identifier already exists.");
  }
  if (input.start === undefined || input.end === undefined) {
    return calendarError(400, "required", "Missing end time.");
  }
  const now = new Date().toISOString();
  const self = { email: calendar.emailAddress, self: true };
  const event: CalendarEventResource = {
    kind: "calendar#event",
    id,
    status: "confirmed",
    created: now,
    updated: now,
    sequence: 0,
    summary: input.summary ?? "",
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.location === undefined ? {} : { location: input.location }),
    start: input.start,
    end: input.end,
    ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
    ...(input.transparency === undefined ? {} : { transparency: input.transparency }),
    organizer: self,
    creator: self,
    ...(input.attendees === undefined
      ? {}
      : { attendees: withSelf(calendar, attendeesOf(input.attendees)) }),
    eventType: "default",
    htmlLink: `https://www.google.com/calendar/event?eid=${id}`,
    iCalUID: `${id}@google.com`,
  };
  const problem = timeProblem(event);
  if (problem !== undefined) return problem;
  withConference(event, input, params.get("conferenceDataVersion"));
  calendar.save(event);
  logWrite(calendar, "insert", id, params, notifiedOf(calendar, event, params.get("sendUpdates")));
  return HttpResponse.json(event);
}

// A patch: each field it sends replaces the event's, arrays whole.
function patched(event: CalendarEventResource, body: EventBody): CalendarEventResource {
  const { attendees } = body;
  // The conference data is made by withConference, and an event's ID never changes.
  const fields = Object.entries(body).filter(
    ([name]) => !["attendees", "conferenceData", "id"].includes(name),
  );
  const defined = Object.fromEntries(fields) as Partial<CalendarEventResource>;
  return {
    ...event,
    ...defined,
    ...(attendees === undefined ? {} : { attendees: attendeesOf(attendees) }),
  };
}

// An update: the event as the body gives it, keeping only what Google sets itself.
function replaced(event: CalendarEventResource, body: EventBody): CalendarEventResource {
  const { id, kind, status, created, updated, sequence, organizer, creator, eventType, htmlLink } =
    event;
  const { iCalUID } = event;
  // The guests and how it shows don't change what the event says, so its sequence stays (as the
  // fake's own guest changes keep it).
  const kept = {
    id,
    kind,
    status,
    created,
    updated,
    sequence,
    organizer,
    creator,
    eventType,
    htmlLink,
  };
  return patched({ ...kept, iCalUID, summary: "", start: event.start, end: event.end }, body);
}

function attendeesOf(input: z.infer<typeof attendee>[]): Attendee[] {
  return input.map((guest) => ({
    ...guest,
    responseStatus: guest.responseStatus ?? "needsAction",
  }));
}

// With guests, the organizer is listed among them too, as Google lists them.
function withSelf(calendar: FakeCalendar, attendees: Attendee[]): Attendee[] {
  if (attendees.length === 0 || attendees.some((a) => a.email === calendar.emailAddress)) {
    return attendees;
  }
  const self: Attendee = {
    email: calendar.emailAddress,
    self: true,
    organizer: true,
    responseStatus: "accepted",
  };
  return [self, ...attendees];
}

// Google refuses an event that ends before it starts, or has no length.
function timeProblem(event: CalendarEventResource): Response | undefined {
  const start = Date.parse(event.start.dateTime);
  const end = Date.parse(event.end.dateTime);
  if (Number.isNaN(start) || Number.isNaN(end)) return invalid("Invalid start or end time.");
  if (end <= start)
    return calendarError(400, "timeRangeEmpty", "The specified time range is empty.");
  return undefined;
}

// A Meet link, made only when the request asks with conferenceDataVersion=1; Google ignores
// conference data otherwise.
function withConference(event: CalendarEventResource, body: EventBody, version: string | null) {
  const create = body.conferenceData?.createRequest;
  if (version !== "1" || create === undefined || event.conferenceData !== undefined) return;
  const code = createHash("sha256").update(`${event.id}/${create.requestId}`).digest("hex");
  const meet = `https://meet.google.com/${code.slice(0, 3)}-${code.slice(3, 7)}-${code.slice(7, 10)}`;
  event.hangoutLink = meet;
  event.conferenceData = {
    createRequest: { ...create, status: { statusCode: "success" } },
    entryPoints: [{ entryPointType: "video", uri: meet }],
    conferenceSolution: { key: { type: "hangoutsMeet" }, name: "Google Meet" },
    conferenceId: meet.slice(meet.lastIndexOf("/") + 1),
  };
}

// Who Google emails about a write: with `all`, every guest but the account; with
// `externalOnly`, those outside its domain; with `none`, or nothing sent, nobody.
function notifiedOf(
  calendar: FakeCalendar,
  event: CalendarEventResource,
  sendUpdates: string | null,
): string[] {
  const guests = (event.attendees ?? [])
    .filter((guest) => guest.self !== true && guest.email !== calendar.emailAddress)
    .map((guest) => guest.email);
  if (sendUpdates === "all") return guests;
  const domain = calendar.emailAddress.slice(calendar.emailAddress.indexOf("@"));
  if (sendUpdates === "externalOnly") return guests.filter((email) => !email.endsWith(domain));
  return [];
}

function logWrite(
  calendar: FakeCalendar,
  call: CalendarWrite["call"],
  eventId: string,
  params: URLSearchParams,
  notified: string[],
) {
  calendar.writes.log.push({
    call,
    eventId,
    sendUpdates: params.get("sendUpdates"),
    notified,
    conferenceDataVersion: params.get("conferenceDataVersion"),
  });
}

function invalid(message: string): Response {
  return calendarError(400, "invalid", message);
}
