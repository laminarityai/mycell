// Telling other features about new mail: each inbound Gmail message a poll or a recovery newly
// stored becomes one discovery/gmail.message_received, which switched-on workflows trigger on,
// and each sent one a discovery/gmail.message_sent, which ends a review its person finished in
// Gmail. The backfill announces neither, so connecting an inbox starts no runs on its history.
// Every Gmail message any of them newly stores, the backfill's included and drafts excepted,
// and every Drive file version, also becomes one discovery/item.stored, which memory learns from.
// A poll also hands on the items it found removed (discovery/item.removed) and the Drive files
// it found changed with no new version, such as their sharing (discovery/item.changed), for
// memory to delete what it learned from them or re-read who may see them.
//
// Storing and sending are two steps. The store step hands on what it newly stored as
// `Received`, `Sent` and `Stored` pointers, and the send step after it sends them, so a failed
// send is retried with the memoized pointers: storing again would find nothing new and send
// nothing.
import type { IngestedApp } from "@/features/connections/types";
import type { Ctx } from "@/lib/ctx";
import type { RunStep } from "@/lib/inngest";
import {
  sendGmailMessagesReceived,
  sendGmailMessagesSent,
  sendItemsRemovedAndChanged,
  sendItemsStored,
} from "@/lib/events";
import type { NormalizedEvent } from "./connector";
import type { NewEvent } from "./store";

/** A newly stored inbound message, as a step hands it on: its ID, time and labels only. */
export type Received = { sourceRef: string; occurredAt: string; labelIds: string[] };

/** A newly stored sent message, as a step hands it on: its ID, thread and time only. */
export type Sent = { sourceRef: string; threadId: string; occurredAt: string };

/**
 * A newly stored item (a Gmail message or a Drive file version), as a step hands it on for
 * memory: its ID and time only.
 */
export type Stored = { sourceRef: string; occurredAt: string };

/**
 * What a poll found gone or changed, reading the app's changes from `cursor`: the IDs of the
 * items removed (Gmail message IDs, Drive file IDs), and the `source_ref`s of the Drive file
 * versions it saw changed but stored already.
 */
export type Changes = { cursor: string; removed: string[]; changed: string[] };

/** What one step newly stored, or a poll found changed, and the step after it announces. */
export type Announced = {
  received: Received[];
  sent: Sent[];
  stored: Stored[];
  changes: Changes | null;
};

/** Nothing to announce: a step that stored nothing. */
export const NOTHING: Announced = { received: [], sent: [], stored: [], changes: null };

/**
 * What to announce of the items one app's step newly stored: for Gmail, as announcedOf says;
 * for Drive, every new file version, for memory only.
 */
export function announcedFor(
  app: IngestedApp,
  created: NewEvent[],
  options: { newMail: boolean },
): Announced {
  if (app === "gmail") return announcedOf(created, options);
  return { received: [], sent: [], stored: created.map(storedOf), changes: null };
}

/**
 * What a poll of one app from `cursor` found gone or changed: the items it found removed, and,
 * for Drive, the files it saw changed whose version it had stored already. Drive's feed doesn't
 * say what changed, so such a change may be to the file's sharing. A new version is announced
 * as stored instead, and learning it reads its sharing anew.
 */
export function changesOf(
  app: IngestedApp,
  cursor: string,
  found: { events: NormalizedEvent[]; removed: string[] },
  created: NewEvent[],
): Changes {
  const createdRefs = new Set(created.map((event) => event.sourceRef));
  const changed =
    app === "drive"
      ? found.events.flatMap((event) => (createdRefs.has(event.sourceRef) ? [] : [event.sourceRef]))
      : [];
  return { cursor, removed: found.removed, changed };
}

function storedOf(event: NewEvent): Stored {
  return { sourceRef: event.sourceRef, occurredAt: event.occurredAt.toISOString() };
}

/**
 * The Gmail messages among `created`: all of them as stored, and, when they're `newMail` (a
 * poll's or a recovery's, not the backfill's), the received and the sent ones. A draft is
 * stored as inbound (it has no SENT label) but is the mailbox's own, often a run's own reply,
 * so it's none of them.
 */
export function announcedOf(created: NewEvent[], { newMail }: { newMail: boolean }): Announced {
  const messages = created.filter((event) => !event.labelIds.includes("DRAFT"));
  const stored = messages.map(storedOf);
  if (!newMail) return { received: [], sent: [], stored, changes: null };
  const received = messages
    .filter((event) => event.direction === "inbound")
    .map((event) => ({
      sourceRef: event.sourceRef,
      occurredAt: event.occurredAt.toISOString(),
      labelIds: event.labelIds,
    }));
  const sent = messages.flatMap((event) =>
    event.direction === "outbound" && event.threadId !== null
      ? [
          {
            sourceRef: event.sourceRef,
            threadId: event.threadId,
            occurredAt: event.occurredAt.toISOString(),
          },
        ]
      : [],
  );
  return { received, sent, stored, changes: null };
}

/**
 * Sends what one app's step announced in a step of its own, named `id`. Nothing to send runs no
 * step.
 */
export async function sendAnnounced(
  ctx: Ctx,
  connectionId: string,
  app: IngestedApp,
  { received, sent, stored, changes }: Announced,
  runStep: RunStep,
  id: string,
): Promise<void> {
  const changed = (changes?.removed.length ?? 0) + (changes?.changed.length ?? 0);
  if (received.length === 0 && sent.length === 0 && stored.length === 0 && changed === 0) return;
  await runStep(id, async () => {
    const orgId = ctx.orgId;
    await sendGmailMessagesReceived(
      received.map((message) => ({ orgId, connectionId, ...message })),
    );
    await sendGmailMessagesSent(sent.map((message) => ({ orgId, connectionId, ...message })));
    await sendItemsStored(stored.map((item) => ({ orgId, connectionId, app, ...item })));
    if (changes !== null) {
      await sendItemsRemovedAndChanged(
        changes.removed.map((itemId) => ({ orgId, connectionId, app, itemId })),
        app === "drive"
          ? changes.changed.map((sourceRef) => ({ orgId, connectionId, app, sourceRef }))
          : [],
        changes.cursor,
      );
    }
    return {};
  });
}
