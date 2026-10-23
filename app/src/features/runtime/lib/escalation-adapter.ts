// The escalation adapter (ADR-0013): a message a run handed to a person waits, read-only, in the
// person's own Gmail. Nothing is prepared or removed there: approving means the person is done
// with it, and replying to it in Gmail finishes it on its own. Every call goes through the Nango
// proxy with the caller's ctx; the message's text is held in memory only (invariant 8).
import { GMAIL } from "@/features/connections/gmail";
import { getConnection, proxyGet } from "@/features/connections/server";
import { fullMessageSchema, mailOf, messageRefSchema } from "./gmail";
import { ItemGoneError } from "@/lib/errors";
import { sentAt, sentSince, threadMessages } from "./gmail-sent";
import type { PendingFormAdapter } from "./pending-forms";

/** What the escalate step hands `prepare`: the message the run started from. */
export type EscalatedMessage = { connectionId: string; messageId: string };

export const escalationAdapter: PendingFormAdapter<EscalatedMessage> = {
  // Points at the message itself (its source_ref) and its thread. ItemGoneError if it's gone.
  async prepare(ctx, input) {
    const message = await proxyGet(
      ctx,
      input.connectionId,
      `${GMAIL}/messages/${encodeURIComponent(input.messageId)}?format=minimal`,
      messageRefSchema,
    );
    if (message === null) throw new ItemGoneError();
    return { itemRef: message.id, threadRef: message.threadId };
  },

  // "Done": the person handled it, so there is nothing to carry out in Gmail.
  approve() {
    return Promise.resolve();
  },

  // A reply sent in its thread after the message finishes it; the message deleted (with its
  // thread, or alone) leaves nothing to review.
  async check(ctx, item) {
    const messages = (await threadMessages(ctx, item.connectionId, item.threadRef)) ?? [];
    const escalated = messages.find((message) => message.id === item.itemRef);
    if (escalated === undefined) return "gone";
    const after = sentAt(escalated, item.createdAt.getTime());
    return sentSince(messages, after, item.itemRef) ? "done_in_app" : "waiting";
  },

  // The message, and where to open it in the connection's own Gmail.
  async view(ctx, item) {
    const message = await proxyGet(
      ctx,
      item.connectionId,
      `${GMAIL}/messages/${encodeURIComponent(item.itemRef)}?format=full`,
      fullMessageSchema,
    );
    if (message === null) throw new ItemGoneError();
    const { accountEmail } = await getConnection(ctx, item.connectionId);
    return { kind: "message", message: mailOf(message), link: gmailLink(accountEmail, item) };
  },
};

/** The message's thread in Gmail's web app, opened in the connection's account. */
function gmailLink(accountEmail: string, item: { threadRef: string }): string {
  const account = encodeURIComponent(accountEmail);
  return `https://mail.google.com/mail/?authuser=${account}#all/${encodeURIComponent(item.threadRef)}`;
}
