// Telling other features about new mail: each inbound Gmail message a poll or a recovery newly
// stored becomes one discovery/gmail.message_received, which switched-on workflows trigger on,
// and each sent one a discovery/gmail.message_sent, which ends a review its person finished in
// Gmail. The backfill announces nothing, so connecting an inbox starts no runs on its history.
//
// Storing and sending are two steps. The store step hands on what it newly stored as
// `Received` and `Sent` pointers, and the send step after it sends them, so a failed send is
// retried with the memoized pointers: storing again would find nothing new and send nothing.
import type { Ctx } from "@/lib/ctx";
import { sendGmailMessagesReceived, sendGmailMessagesSent } from "@/lib/events";
import type { RunStep } from "./ingest-steps";
import type { NewEvent } from "./store";

/** A newly stored inbound message, as a step hands it on: its ID, time and labels only. */
export type Received = { sourceRef: string; occurredAt: string; labelIds: string[] };

/** A newly stored sent message, as a step hands it on: its ID, thread and time only. */
export type Sent = { sourceRef: string; threadId: string; occurredAt: string };

/** What one step newly stored and the step after it announces. */
export type Announced = { received: Received[]; sent: Sent[] };

/** Nothing to announce: what an app other than Gmail stores, or a step that stored nothing. */
export const NOTHING: Announced = { received: [], sent: [] };

/**
 * The received and the sent messages among `created`. A draft is stored as inbound (it has no
 * SENT label) but is the mailbox's own, often a run's own reply, so it's neither.
 */
export function announcedOf(created: NewEvent[]): Announced {
  const received = created
    .filter((event) => event.direction === "inbound" && !event.labelIds.includes("DRAFT"))
    .map((event) => ({
      sourceRef: event.sourceRef,
      occurredAt: event.occurredAt.toISOString(),
      labelIds: event.labelIds,
    }));
  const sent = created.flatMap((event) =>
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
  return { received, sent };
}

/** Sends `announced` in a step of its own, named `id`. Nothing to send runs no step. */
export async function sendAnnounced(
  ctx: Ctx,
  connectionId: string,
  { received, sent }: Announced,
  runStep: RunStep,
  id: string,
): Promise<void> {
  if (received.length === 0 && sent.length === 0) return;
  await runStep(id, async () => {
    const orgId = ctx.orgId;
    await sendGmailMessagesReceived(
      received.map((message) => ({ orgId, connectionId, ...message })),
    );
    await sendGmailMessagesSent(sent.map((message) => ({ orgId, connectionId, ...message })));
    return {};
  });
}
