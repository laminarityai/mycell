// The catalog's Calendar actions (#69): reading an event, and booking a meeting whose guests are
// invited only once a person approves it (ADR-0013). Their risk levels are fixed here, as the rest
// of the catalog's are in `catalog.ts`, which lists them with the others.
import { z } from "zod";
import { emailAddressesIn } from "@/lib/email-addresses";
import { GOOGLE_HOSTS, googleScope as scope } from "@/lib/google";
import type { CatalogAction } from "./types";

const CALENDAR_HOST = GOOGLE_HOSTS.www;
const CALENDAR_READ = [
  scope("calendar.events"),
  scope("calendar"),
  scope("calendar.events.readonly"),
  scope("calendar.readonly"),
];
const CALENDAR_WRITE = [scope("calendar.events"), scope("calendar")];

const id = z.string().min(1);
// A time with its UTC offset, as Calendar takes it: 2026-11-02T15:00:00+01:00.
const dateTime = z.iso.datetime({ offset: true });
// A guest: an address, alone or with a name ("Ada <ada@customer.test>").
const guest = z
  .string()
  .refine((text) => emailAddressesIn(text).length === 1, "Give one email address per guest.");
// How a booked event shows once approved; until then it's private and doesn't block time.
const visibility = z.enum(["default", "public", "private", "confidential"]);
const transparency = z.enum(["opaque", "transparent"]);

export const calendarActions = [
  {
    kind: "catalog",
    name: "google-calendar.read-event",
    app: "Calendar",
    description:
      "Read one event on the person's calendar: its title, description, times, place, " +
      "organizer and guests.",
    risk: "read",
    integration: "google",
    host: CALENDAR_HOST,
    scopes: CALENDAR_READ,
    input: z.object({ eventId: id }),
    // Its title and description pass to later steps, never into run records (ADR-0021).
    output: z.object({
      eventId: id,
      title: z.string(),
      description: z.string(),
      start: z.string(),
      end: z.string(),
      location: z.string(),
      organizer: z.string(),
      guests: z.array(z.string()),
      guestCount: z.number().int().nonnegative(),
    }),
    conditionFields: [
      { name: "guestCount", type: "number", label: "The number of guests besides the person" },
    ],
  },
  {
    kind: "catalog",
    name: "google-calendar.create-event",
    app: "Calendar",
    description:
      "Book a meeting on the person's calendar and invite guests once a person approves it. " +
      "Until then the event has no guests, is private and doesn't block time. Adds a Google " +
      "Meet link only when `meet` is true.",
    pendingForm: "an event on the person's calendar with no guests until approved",
    channel: "calendar_events",
    risk: "external_send",
    integration: "google",
    host: CALENDAR_HOST,
    scopes: CALENDAR_WRITE,
    input: z
      .object({
        title: z.string().trim().min(1).max(1024),
        description: z.string().max(8000).optional(),
        start: dateTime,
        end: dateTime,
        // The IANA time zone the event is shown in, such as Europe/London.
        timeZone: z.string().min(1).optional(),
        location: z.string().max(1024).optional(),
        guests: z.array(guest).min(1).max(50),
        meet: z.boolean().default(false),
        // How the event shows once approved: Calendar's default visibility, and busy.
        visibility: visibility.default("default"),
        transparency: transparency.default("opaque"),
      })
      .refine((event) => Date.parse(event.end) > Date.parse(event.start), {
        message: "End the meeting after it starts.",
        path: ["end"],
      }),
    // Pointers and addresses only: the title and description stay on the calendar.
    output: z.object({
      eventId: id,
      guests: z.array(z.string()),
      visibility,
      transparency,
    }),
  },
] as const satisfies readonly CatalogAction[];
