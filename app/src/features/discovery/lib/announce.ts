// Telling other features about new mail: each inbound Gmail message a poll or a recovery newly
// stored becomes one discovery/gmail.message_received, which switched-on workflows trigger on,
// and each sent one a discovery/gmail.message_sent, which ends a review its person finished in
// Gmail. The backfill announces neither, so connecting an inbox starts no runs on its history.
// Every Gmail message any of them newly stores, the backfill's included and drafts excepted,
// also becomes one discovery/item.stored, which memory learns from.
//
// Storing and sending are two steps. The store step hands on what it newly stored as
// `Received`, `Sent` and `Stored` pointers, and the send step after it sends them, so a failed
// send is retried with the memoized pointers: storing again would find nothing new and send
// nothing.
import type { Ctx } from "@/lib/ctx";
import { sendGmailMessagesReceived, sendGmailMessagesSent, sendItemsStored } from "@/lib/events";
import type { RunStep } from "./ingest-steps";
import type { NewEvent } from "./store";

/** A newly stored inbound message, as a step hands it on: its ID, time and labels only. */
export type Received = { sourceRef: string; occurredAt: string; labelIds: string[] };

/** A newly stored sent message, as a step hands it on: its ID, thread and time only. */
export type Sent = { sourceRef: string; threadId: string; occurredAt: string };

/** A newly stored Gmail message, as a step hands it on for memory: its ID and time only. */
export type Stored = { sourceRef: string; occurredAt: string };

/** What one step newly stored and the step after it announces. */
export type Announced = { received: Received[]; sent: Sent[]; stored: Stored[] };

/** Nothing to announce: what an app other than Gmail stores, or a step that stored nothing. */
export const NOTHING: Announced = { received: [], sent: [], stored: [] };

/**
 * The Gmail messages among `created`: all of them as stored, and, when they're `newMail` (a
 * poll's or a recovery's, not the backfill's), the received and the sent ones. A draft is
 * stored as inbound (it has no SENT label) but is the mailbox's own, often a run's own reply,
 * so it's none of them.
 */
export function announcedOf(created: NewEvent[], { newMail }: { newMail: boolean }): Announced {
  const messages = created.filter((event) => !event.labelIds.includes("DRAFT"));
  const stored = messages.map((event) => ({
    sourceRef: event.sourceRef,
    occurredAt: event.occurredAt.toISOString(),
  }));
  if (!newMail) return { received: [], sent: [], stored };
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
  return { received, sent, stored };
}

/** Sends `announced` in a step of its own, named `id`. Nothing to send runs no step. */
export async function sendAnnounced(
  ctx: Ctx,
  connectionId: string,
  { received, sent, stored }: Announced,
  runStep: RunStep,
  id: string,
): Promise<void> {
  if (received.length === 0 && sent.length === 0 && stored.length === 0) return;
  await runStep(id, async () => {
    const orgId = ctx.orgId;
    await sendGmailMessagesReceived(
      received.map((message) => ({ orgId, connectionId, ...message })),
    );
    await sendGmailMessagesSent(sent.map((message) => ({ orgId, connectionId, ...message })));
    await sendItemsStored(
      stored.map((message) => ({ orgId, connectionId, app: "gmail" as const, ...message })),
    );
    return {};
  });
}
