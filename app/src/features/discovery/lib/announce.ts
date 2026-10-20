// Telling runtime about new mail: each inbound Gmail message a poll or a recovery newly stored
// becomes one discovery/gmail.message_received, which switched-on workflows trigger on. The
// backfill announces nothing, so connecting an inbox starts no runs on its history.
import type { Ctx } from "@/lib/ctx";
import { sendGmailMessagesReceived } from "@/lib/events";
import type { NewEvent } from "./store";

/**
 * Announces the received messages among `created`. A sent message is outbound; a draft is
 * stored as inbound (it has no SENT label) but is the mailbox's own, often a run's own reply.
 */
export async function announceReceived(
  ctx: Ctx,
  connectionId: string,
  created: NewEvent[],
): Promise<void> {
  await sendGmailMessagesReceived(
    created
      .filter((event) => event.direction === "inbound" && !event.labelIds.includes("DRAFT"))
      .map((event) => ({
        orgId: ctx.orgId,
        connectionId,
        sourceRef: event.sourceRef,
        occurredAt: event.occurredAt.toISOString(),
        labelIds: event.labelIds,
      })),
  );
}
