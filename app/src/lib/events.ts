// Inngest events one feature sends and another triggers on, where neither may import the other:
// discovery sends gmail.message_received, and runtime's fan-out triggers on it.
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
