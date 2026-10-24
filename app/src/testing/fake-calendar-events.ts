// The fake Google Calendar's shapes (`fake-calendar.ts`, `fake-calendar-writes.ts`): an event
// as Google's events resource gives it, an invite a test seeds, and the log of writes Mycel made.

/** An invite to seed: an event someone else organised, with the account among its guests. */
export type FakeInviteInput = {
  title: string;
  organizer: string;
  // When it was made: when it reached the calendar. Now, by default.
  at?: Date;
  description?: string;
  start?: Date;
  // Other guests besides the account.
  guests?: string[];
  eventType?: CalendarEventResource["eventType"];
  attendeesOmitted?: boolean;
  location?: string;
};

export type Attendee = {
  email: string;
  self?: boolean;
  organizer?: boolean;
  responseStatus: "needsAction" | "declined" | "tentative" | "accepted";
};

/** An events resource, with the fields Mycel's requests can name. */
export type CalendarEventResource = {
  kind: "calendar#event";
  id: string;
  status: "confirmed" | "tentative" | "cancelled";
  created: string;
  updated: string;
  // Goes up each time the organizer changes what the event says, as iCalendar's SEQUENCE.
  sequence: number;
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
  visibility?: "default" | "public" | "private" | "confidential";
  transparency?: "opaque" | "transparent";
  organizer: { email: string; self?: boolean };
  creator: { email: string; self?: boolean };
  attendees?: Attendee[];
  attendeesOmitted?: boolean;
  eventType: "default" | "fromGmail" | "focusTime" | "outOfOffice" | "workingLocation";
  htmlLink: string;
  iCalUID: string;
  hangoutLink?: string;
  conferenceData?: Record<string, unknown>;
};

/** One write the calendar made. */
export type CalendarWrite = {
  call: "insert" | "patch" | "update" | "delete";
  eventId: string;
  /** The request's `sendUpdates`, or null when it sent none (Google then emails nobody). */
  sendUpdates: string | null;
  /** The guests Google emailed about this write: an invitation, an update or a cancellation. */
  notified: string[];
  /** The request's `conferenceDataVersion`, or null. */
  conferenceDataVersion: string | null;
};

/** The calendar's log of writes, and the answers a test asked it to lose. */
export class CalendarWrites {
  readonly log: CalendarWrite[] = [];
  private answersToLose = 0;

  /** The next write is made, but answered 503, as when its answer is lost on the way back. */
  loseNextAnswer(): void {
    this.answersToLose += 1;
  }

  takeLostAnswer(): boolean {
    if (this.answersToLose === 0) return false;
    this.answersToLose -= 1;
    return true;
  }
}
