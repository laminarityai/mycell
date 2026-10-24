// A fake Google Calendar, served through the fake Nango's proxy: the account's primary calendar,
// answering the Calendar API v3 calls Mycel makes (events.list, with sync tokens, and
// events.get; the writes are in `fake-calendar-writes.ts`) in the shapes Google documents, from
// events a test seeds or Mycel makes. Like Google, a sync
// token lists only what changed since it was handed out, deletions included as `cancelled`; it
// answers 410 once a test expires the tokens; and it answers 400 to a sync token combined with
// a filter, or to a request whose other parameters differ from the request that made the token
// (https://developers.google.com/workspace/calendar/api/guides/sync). Like Google, an event's
// `sequence` goes up when its organizer changes what it says (its title or description),
// and not when a guest answers; and the same event on several calendars (`receive`) shares its
// ID and iCalUID.
import { randomBytes } from "node:crypto";
import { HttpResponse } from "msw";
import {
  CalendarWrites,
  type Attendee,
  type CalendarEventResource,
  type FakeInviteInput,
} from "./fake-calendar-events";
import { parseFields, project } from "./fake-drive-fields";

// Query parameters a sync token can't be combined with, as Google lists them.
const NOT_WITH_SYNC_TOKEN = [
  "iCalUID",
  "orderBy",
  "privateExtendedProperty",
  "q",
  "sharedExtendedProperty",
  "timeMin",
  "timeMax",
  "updatedMin",
];

// A sync token: the change it lists from, and the parameters of the request that made it.
type SyncToken = { from: number; params: string };
// A page token: the rest of a listing, and its parameters.
type PageToken = { ids: string[]; incremental: boolean; params: string; end: number };

type ListError = { status: 400 | 410; reason: string; message: string };

export class FakeCalendar {
  private events = new Map<string, CalendarEventResource>();
  // Each event's latest change, by the change number it was made at.
  private changedAt = new Map<string, number>();
  private change = 0;
  private syncTokens = new Map<string, SyncToken>();
  private pageTokens = new Map<string, PageToken>();
  /** Every events.list request's query parameters, oldest first. */
  readonly listRequests: URLSearchParams[] = [];
  /** The sync token handed out last, if any. */
  lastSyncToken: string | undefined;
  /** Every write made (events.insert, patch, update, delete), and who each one emailed. */
  readonly writes = new CalendarWrites();

  constructor(readonly emailAddress: string) {}

  /** Someone else invites the account: the event lands on its calendar, unanswered. */
  invite(input: FakeInviteInput): CalendarEventResource {
    const at = (input.at ?? new Date()).toISOString();
    const start = input.start ?? new Date(Date.now() + 24 * 60 * 60 * 1000);
    const id = eventId();
    const event: CalendarEventResource = {
      kind: "calendar#event",
      id,
      status: "confirmed",
      created: at,
      updated: at,
      sequence: 0,
      summary: input.title,
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.location === undefined ? {} : { location: input.location }),
      start: { dateTime: start.toISOString() },
      end: { dateTime: new Date(start.getTime() + 30 * 60 * 1000).toISOString() },
      organizer: { email: input.organizer },
      creator: { email: input.organizer },
      attendees: [
        { email: input.organizer, organizer: true, responseStatus: "accepted" },
        { email: this.emailAddress, self: true, responseStatus: "needsAction" },
        ...(input.guests ?? []).map((email) => ({
          email,
          responseStatus: "needsAction" as const,
        })),
      ],
      ...(input.attendeesOmitted === true ? { attendeesOmitted: true } : {}),
      eventType: input.eventType ?? "default",
      htmlLink: `https://www.google.com/calendar/event?eid=${id}`,
      iCalUID: `${id}@google.com`,
    };
    this.save(event);
    return event;
  }

  /** The account makes an event itself, inviting `guests` (none: an event of its own). */
  organize(
    input: Omit<FakeInviteInput, "organizer" | "guests" | "attendeesOmitted"> & {
      guests: string[];
    },
  ): CalendarEventResource {
    const event = this.invite({ ...input, organizer: this.emailAddress });
    event.organizer = { email: this.emailAddress, self: true };
    event.creator = { email: this.emailAddress, self: true };
    event.attendees =
      input.guests.length === 0
        ? undefined
        : [
            { email: this.emailAddress, self: true, organizer: true, responseStatus: "accepted" },
            ...input.guests.map((email) => ({ email, responseStatus: "needsAction" as const })),
          ];
    if (event.attendees === undefined) delete event.attendees;
    return event;
  }

  /**
   * The same event, as Google puts it on this account's calendar too: another calendar's event
   * that names this account as a guest (or organizer). Same ID and iCalUID; `self` marks this
   * account's own entries.
   */
  receive(event: CalendarEventResource): CalendarEventResource {
    const mine = (email: string) => email.toLowerCase() === this.emailAddress.toLowerCase();
    const copy: CalendarEventResource = {
      ...structuredClone(event),
      organizer: { email: event.organizer.email, self: mine(event.organizer.email) || undefined },
      creator: { email: event.creator.email, self: mine(event.creator.email) || undefined },
      attendees: event.attendees?.map((guest) => ({
        ...guest,
        self: mine(guest.email) || undefined,
      })),
    };
    this.save(copy);
    return copy;
  }

  /**
   * The organizer changes what the event says (its title or description): listed as changed
   * again, at a new sequence.
   */
  edit(id: string, changes: { title?: string; description?: string }): void {
    const event = this.event(id);
    if (changes.title !== undefined) event.summary = changes.title;
    if (changes.description !== undefined) event.description = changes.description;
    event.sequence += 1;
    event.updated = new Date().toISOString();
    this.save(event);
  }

  /**
   * The organizer changes who's invited, leaving what the event says as it was: listed as
   * changed again, at the same sequence.
   */
  setGuests(id: string, guests: string[]): void {
    const event = this.event(id);
    const kept = (event.attendees ?? []).filter(
      (attendee) => attendee.organizer === true || attendee.self === true,
    );
    event.attendees = [
      ...kept,
      ...guests
        .filter((email) => !kept.some((attendee) => attendee.email === email))
        .map((email) => ({ email, responseStatus: "needsAction" as const })),
    ];
    event.updated = new Date().toISOString();
    this.save(event);
  }

  /** The account answers the invite. */
  respond(id: string, responseStatus: Attendee["responseStatus"]): void {
    const event = this.event(id);
    for (const attendee of event.attendees ?? []) {
      if (attendee.self === true) attendee.responseStatus = responseStatus;
    }
    event.updated = new Date().toISOString();
    this.save(event);
  }

  /** The organizer cancels it: listed as `cancelled` to a sync token, and hidden otherwise. */
  cancel(id: string): void {
    const event = this.event(id);
    event.status = "cancelled";
    event.updated = new Date().toISOString();
    this.save(event);
  }

  /** Google stops accepting every sync token handed out so far: they then answer 410. */
  expireSyncTokens(): void {
    this.syncTokens.clear();
  }

  event(id: string): CalendarEventResource {
    const event = this.events.get(id);
    if (event === undefined) throw new Error(`The fake Calendar has no event ${id}`);
    return event;
  }

  /** The event, a cancelled one included, or undefined when the calendar never had it. */
  find(id: string): CalendarEventResource | undefined {
    return this.events.get(id);
  }

  /** Every event Mycel or the account made on the calendar that isn't cancelled. */
  organized(): CalendarEventResource[] {
    return [...this.events.values()].filter(
      (event) => event.organizer.self === true && event.status !== "cancelled",
    );
  }

  /** The account deletes the event in Calendar: it stays, `cancelled`, as Google keeps it. */
  delete(id: string): void {
    this.cancel(id);
  }

  /** The account adds guests to the event in Calendar itself, as invited people. */
  addGuests(id: string, emails: string[]): void {
    const event = this.event(id);
    event.attendees = [
      ...(event.attendees ?? [
        { email: this.emailAddress, self: true, organizer: true, responseStatus: "accepted" },
      ]),
      ...emails.map((email) => ({ email, responseStatus: "needsAction" as const })),
    ];
    event.updated = new Date().toISOString();
    this.save(event);
  }

  /** events.list on the primary calendar: everything, or what changed since a sync token. */
  list(params: URLSearchParams): Response {
    this.listRequests.push(new URLSearchParams(params));
    const listed = this.listing(params);
    if ("status" in listed) return calendarError(listed.status, listed.reason, listed.message);
    const pageSize = Math.min(Number(params.get("maxResults") ?? 250), 2500);
    const page = listed.ids.slice(0, pageSize);
    const rest = listed.ids.slice(pageSize);
    const tokens: { nextPageToken?: string; nextSyncToken?: string } = {};
    if (rest.length > 0) {
      tokens.nextPageToken = this.token(this.pageTokens, { ...listed, ids: rest });
    } else {
      tokens.nextSyncToken = this.token(this.syncTokens, {
        from: listed.end,
        params: listed.params,
      });
      this.lastSyncToken = tokens.nextSyncToken;
    }
    const body = {
      kind: "calendar#events",
      items: page.map((id) => this.shown(this.event(id), listed.incremental)),
      ...tokens,
    };
    const fields = params.get("fields");
    return HttpResponse.json(fields === null ? body : project(body, parseFields(fields)));
  }

  /** events.get: the event, a cancelled one included, or 404. */
  get(id: string, params: URLSearchParams): Response {
    const event = this.events.get(id);
    if (event === undefined) return calendarError(404, "notFound", "Not Found");
    const fields = params.get("fields");
    return HttpResponse.json(fields === null ? event : project(event, parseFields(fields)));
  }

  // The events a request lists, from a page token, a sync token, or the start.
  private listing(params: URLSearchParams): PageToken | ListError {
    const signature = paramsSignature(params);
    const syncToken = params.get("syncToken");
    if (syncToken !== null) {
      const clash = NOT_WITH_SYNC_TOKEN.find((name) => params.has(name));
      if (clash !== undefined) {
        return { status: 400, reason: "invalid", message: `syncToken can't be used with ${clash}` };
      }
    }
    const pageToken = params.get("pageToken");
    if (pageToken !== null) {
      const page = this.pageTokens.get(pageToken);
      if (page === undefined) return { status: 400, reason: "invalid", message: "Bad pageToken" };
      if (page.params !== signature) return mismatch();
      return page;
    }
    if (syncToken !== null) {
      const token = this.syncTokens.get(syncToken);
      if (token === undefined) {
        return {
          status: 410,
          reason: "fullSyncRequired",
          message: "Sync token is no longer valid, a full sync is required.",
        };
      }
      if (token.params !== signature) return mismatch();
      const ids = [...this.changedAt]
        .filter(([, at]) => at > token.from)
        .sort((a, b) => a[1] - b[1])
        .map(([id]) => id);
      return { ids, incremental: true, params: signature, end: this.change };
    }
    const showDeleted = params.get("showDeleted") === "true";
    const updatedMin = Date.parse(params.get("updatedMin") ?? "") || Number.NEGATIVE_INFINITY;
    const listed = [...this.events.values()].filter(
      (event) =>
        (showDeleted || event.status !== "cancelled") && Date.parse(event.updated) >= updatedMin,
    );
    // Ordered by when each last changed, oldest first, when asked; Google's order otherwise.
    if (params.get("orderBy") === "updated") {
      listed.sort((a, b) => Date.parse(a.updated) - Date.parse(b.updated));
    }
    const ids = listed.map((event) => event.id);
    return { ids, incremental: false, params: signature, end: this.change };
  }

  // A cancelled event, as an incremental listing shows a deletion: its ID and status alone.
  private shown(event: CalendarEventResource, incremental: boolean) {
    if (event.status === "cancelled" && incremental) {
      return { kind: event.kind, id: event.id, status: event.status };
    }
    return event;
  }

  /** Stores the event as changed now, so a sync token lists it. */
  save(event: CalendarEventResource): void {
    this.change += 1;
    this.events.set(event.id, event);
    this.changedAt.set(event.id, this.change);
  }

  private token<T>(tokens: Map<string, T>, value: T): string {
    const token = randomBytes(12).toString("base64url");
    tokens.set(token, value);
    return token;
  }
}

// What must match between a sync token's request and a later one: every parameter but the
// tokens themselves.
function paramsSignature(params: URLSearchParams): string {
  return [...params]
    .filter(([name]) => name !== "syncToken" && name !== "pageToken")
    .map(([name, value]) => `${name}=${value}`)
    .sort()
    .join("&");
}

function mismatch(): ListError {
  return {
    status: 400,
    reason: "invalid",
    message: "The request's parameters differ from those the sync token was made with.",
  };
}

// Calendar's event IDs: base32hex, lowercase.
export function eventId(): string {
  const digits = "0123456789abcdefghijklmnopqrstuv";
  return [...randomBytes(20)].map((byte) => digits[byte % 32]).join("");
}

export const PRIMARY_EVENTS = "/calendar/v3/calendars/primary/events";

// The Calendar API behind the proxy, answering from the connection's calendar.
export function calendarResponse(calendar: FakeCalendar, path: string, params: URLSearchParams) {
  if (path === PRIMARY_EVENTS) return calendar.list(params);
  if (path.startsWith(`${PRIMARY_EVENTS}/`)) {
    return calendar.get(decodeURIComponent(path.slice(PRIMARY_EVENTS.length + 1)), params);
  }
  throw new Error(`The fake Calendar doesn't serve ${path}`);
}

// An error as Calendar returns it.
export function calendarError(code: number, reason: string, message: string) {
  return HttpResponse.json(
    { error: { code, message, errors: [{ domain: "global", reason, message }] } },
    { status: code },
  );
}
