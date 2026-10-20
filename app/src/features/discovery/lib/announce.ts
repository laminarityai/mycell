// Telling runtime about new mail: each inbound Gmail message a poll or a recovery newly stored
// becomes one discovery/gmail.message_received, which switched-on workflows trigger on. The
// backfill announces nothing, so connecting an inbox starts no runs on its history.
//
// Storing and sending are two steps. The store step hands on what it newly stored as `Received`
// pointers, and the send step after it sends them, so a failed send is retried with the
// memoized pointers: storing again would find nothing new and send nothing.
import type { Ctx } from "@/lib/ctx";
import { sendGmailMessagesReceived } from "@/lib/events";
import type { RunStep } from "./ingest-steps";
import type { NewEvent } from "./store";

/** A newly stored inbound message, as a step hands it on: its ID, time and labels only. */
export type Received = { sourceRef: string; occurredAt: string; labelIds: string[] };

/**
 * The received messages among `created`. A sent message is outbound; a draft is stored as
 * inbound (it has no SENT label) but is the mailbox's own, often a run's own reply.
 */
export function receivedOf(created: NewEvent[]): Received[] {
  return created
    .filter((event) => event.direction === "inbound" && !event.labelIds.includes("DRAFT"))
    .map((event) => ({
      sourceRef: event.sourceRef,
      occurredAt: event.occurredAt.toISOString(),
      labelIds: event.labelIds,
    }));
}

/** Sends `received` in a step of its own, named `id`. Nothing to send runs no step. */
export async function announceReceived(
  ctx: Ctx,
  connectionId: string,
  received: Received[],
  runStep: RunStep,
  id: string,
): Promise<void> {
  if (received.length === 0) return;
  await runStep(id, async () => {
    await sendGmailMessagesReceived(
      received.map((message) => ({ orgId: ctx.orgId, connectionId, ...message })),
    );
    return {};
  });
}
