// Inngest events one feature sends and another triggers on, where neither may import the other:
// discovery sends gmail.message_received, and runtime's fan-out triggers on it; discovery sends
// gmail.message_sent, and reviews ends a review its person finished in Gmail; discovery sends
// item.stored, and memory learns from the item; discovery sends item.removed and item.changed,
// and memory deletes what it learned from the item or re-reads who may see it; runtime's Calendar
// poll sends calendar/event.changed and calendar/event.removed, and memory learns from the event,
// re-reads who may see it or deletes what it learned from it; granting credits sends
// credits.granted, and memory learns what it postponed for want of credits.
import { eventType } from "inngest";
import { z } from "zod";
import { inngest } from "./inngest";

/**
 * Polling (or a recovery) newly stored an inbound Gmail message on a connection. Pointers and
 * labels only: `sourceRef` is the Gmail message ID, re-fetched by whatever needs its content.
 */
export const gmailMessageReceived = eventType("discovery/gmail.message_received", {
  schema: z.object({
    orgId: z.string().min(1),
    connectionId: z.string().min(1),
    sourceRef: z.string().min(1),
    occurredAt: z.iso.datetime(),
    labelIds: z.array(z.string()),
  }),
});

export type GmailMessageReceived = z.infer<typeof gmailMessageReceived.schema>;

/** Sends one event per message. The event ID makes a resent message start nothing new. */
export async function sendGmailMessagesReceived(messages: GmailMessageReceived[]): Promise<void> {
  if (messages.length === 0) return;
  await inngest.send(
    messages.map((data) =>
      gmailMessageReceived.create(data, {
        id: `gmail-received-${data.connectionId}-${data.sourceRef}`,
      }),
    ),
  );
}

/**
 * Polling (or a recovery) newly stored a sent Gmail message on a connection: the person sent a
 * draft, or replied, from Gmail itself. Pointers only: the message's ID and its thread's.
 */
export const gmailMessageSent = eventType("discovery/gmail.message_sent", {
  schema: z.object({
    orgId: z.string().min(1),
    connectionId: z.string().min(1),
    sourceRef: z.string().min(1),
    threadId: z.string().min(1),
    occurredAt: z.iso.datetime(),
  }),
});

export type GmailMessageSent = z.infer<typeof gmailMessageSent.schema>;

/** Sends one event per sent message. The event ID makes a resent message end nothing new. */
export async function sendGmailMessagesSent(messages: GmailMessageSent[]): Promise<void> {
  if (messages.length === 0) return;
  await inngest.send(
    messages.map((data) =>
      gmailMessageSent.create(data, { id: `gmail-sent-${data.connectionId}-${data.sourceRef}` }),
    ),
  );
}

/**
 * A backfill, a poll or a recovery newly stored an item from an app on a connection: each Gmail
 * message except drafts, received or sent, and each Drive file version. Memory learns from it.
 * Pointers only: `sourceRef` is how the item is re-fetched (a Gmail message ID, or a Drive
 * file's `<file ID>@<modified time>`).
 */
export const itemStored = eventType("discovery/item.stored", {
  schema: z.object({
    orgId: z.string().min(1),
    connectionId: z.string().min(1),
    app: z.enum(["gmail", "drive"]),
    sourceRef: z.string().min(1),
    occurredAt: z.iso.datetime(),
  }),
});

export type ItemStored = z.infer<typeof itemStored.schema>;

/** Sends one event per item. The event ID makes a resent item start nothing new. */
export async function sendItemsStored(items: ItemStored[]): Promise<void> {
  if (items.length === 0) return;
  await inngest.send(
    items.map((data) =>
      itemStored.create(data, {
        id: `item-stored-${data.connectionId}-${data.app}-${data.sourceRef}`,
      }),
    ),
  );
}

/**
 * A poll found an item gone from a connection's app: a Gmail message deleted or moved to the
 * trash, or a Drive file deleted, trashed or no longer shared with the account. Memory deletes
 * what it learned from that copy. `itemId` is the Gmail message ID, or the Drive file ID (every
 * version of the file).
 */
export const itemRemoved = eventType("discovery/item.removed", {
  schema: z.object({
    orgId: z.string().min(1),
    connectionId: z.string().min(1),
    app: z.enum(["gmail", "drive"]),
    itemId: z.string().min(1),
  }),
});

export type ItemRemoved = z.infer<typeof itemRemoved.schema>;

/**
 * A poll found a Drive file changed with no new version, such as its sharing: Drive's changes
 * feed doesn't say what changed. Memory re-reads who may see it. `sourceRef` is the version the
 * file is at, `<file ID>@<modified time>`.
 */
export const itemChanged = eventType("discovery/item.changed", {
  schema: z.object({
    orgId: z.string().min(1),
    connectionId: z.string().min(1),
    app: z.enum(["drive"]),
    sourceRef: z.string().min(1),
  }),
});

export type ItemChanged = z.infer<typeof itemChanged.schema>;

/**
 * Sends one event per item one poll found removed or changed, reading the app's changes from
 * `cursor`. The event IDs name the cursor, so a resent poll starts nothing new, while the same
 * item changing again, found by a later poll, does.
 */
export async function sendItemsRemovedAndChanged(
  removed: ItemRemoved[],
  changed: ItemChanged[],
  cursor: string,
): Promise<void> {
  if (removed.length === 0 && changed.length === 0) return;
  await inngest.send([
    ...removed.map((data) =>
      itemRemoved.create(data, {
        id: `item-removed-${data.connectionId}-${data.app}-${data.itemId}-${cursor}`,
      }),
    ),
    ...changed.map((data) =>
      itemChanged.create(data, {
        id: `item-changed-${data.connectionId}-${data.app}-${data.sourceRef}-${cursor}`,
      }),
    ),
  ]);
}

/**
 * The Calendar poll (runtime's, which memory shares, ADR-0029) found an event made or changed on
 * a connection's primary calendar. Memory learns from it, if it hasn't learned this version, and
 * reads again who may see it. Pointers only: `sourceRef` is `<event ID>@<sequence>`, the version
 * of the event as its organizer last changed what it says, and `occurredAt` when it last changed.
 */
export const calendarEventChanged = eventType("calendar/event.changed", {
  schema: z.object({
    orgId: z.string().min(1),
    connectionId: z.string().min(1),
    app: z.literal("calendar"),
    sourceRef: z.string().min(1),
    occurredAt: z.iso.datetime(),
  }),
});

export type CalendarEventChanged = z.infer<typeof calendarEventChanged.schema>;

/**
 * The Calendar poll found an event gone from a connection's primary calendar: cancelled, deleted,
 * or no longer the account's. Memory deletes what it learned from it. `itemId` is the event ID
 * (every version of the event).
 */
export const calendarEventRemoved = eventType("calendar/event.removed", {
  schema: z.object({
    orgId: z.string().min(1),
    connectionId: z.string().min(1),
    app: z.literal("calendar"),
    itemId: z.string().min(1),
  }),
});

export type CalendarEventRemoved = z.infer<typeof calendarEventRemoved.schema>;

/**
 * Sends one event per calendar event one poll found changed or removed, listing from the sync
 * token `syncToken`. The event IDs name the token, so a resent poll starts nothing new, while the
 * same event changing again, found by a later poll, does.
 */
export async function sendCalendarEventsChanged(
  changed: CalendarEventChanged[],
  removed: CalendarEventRemoved[],
  syncToken: string,
): Promise<void> {
  if (changed.length === 0 && removed.length === 0) return;
  await inngest.send([
    ...changed.map((data) =>
      calendarEventChanged.create(data, {
        id: `calendar-changed-${data.connectionId}-${data.sourceRef}-${syncToken}`,
      }),
    ),
    ...removed.map((data) =>
      calendarEventRemoved.create(data, {
        id: `calendar-removed-${data.connectionId}-${data.itemId}-${syncToken}`,
      }),
    ),
  ]);
}

/**
 * Credits were granted to an org (`pnpm credits:grant`, our team's way to grant them): work that
 * stopped for want of credits can go on.
 */
export const creditsGranted = eventType("credits/granted", {
  schema: z.object({ orgId: z.string().min(1) }),
});

export async function sendCreditsGranted(orgId: string): Promise<void> {
  await inngest.send(creditsGranted.create({ orgId }));
}
