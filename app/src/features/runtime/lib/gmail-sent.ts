// Whether a person sent mail in a Gmail thread themselves: how the pending-form adapters see a
// review finished in Gmail (a draft sent from there, or an escalated message replied to). Reads
// labels and times only, never content.
import type { z } from "zod";
import { GMAIL, messageSchema, threadSchema } from "@/features/connections/gmail";
import { proxyGet } from "@/features/connections/server";
import type { Ctx } from "@/lib/ctx";

// A message in a thread, without its headers or body. Its date may be missing: sentAt falls back.
const threadMessageSchema = messageSchema
  .pick({ id: true, labelIds: true, internalDate: true })
  .partial({ internalDate: true });
const minimalThreadSchema = threadSchema(threadMessageSchema);

/** A message in a thread, by its ID, labels and when Gmail received or sent it. */
export type ThreadMessage = z.infer<typeof threadMessageSchema>;

/** The thread's messages, without their headers or bodies; null when the thread is gone. */
export async function threadMessages(
  ctx: Ctx,
  connectionId: string,
  threadId: string,
): Promise<ThreadMessage[] | null> {
  const thread = await proxyGet(
    ctx,
    connectionId,
    `${GMAIL}/threads/${encodeURIComponent(threadId)}?format=minimal`,
    minimalThreadSchema,
  );
  return thread?.messages ?? null;
}

/** When Gmail dated the message, in milliseconds; `fallback` when it didn't say. */
export function sentAt(message: ThreadMessage, fallback = 0): number {
  return message.internalDate === undefined ? fallback : Number(message.internalDate);
}

/**
 * Whether one of `messages` (other than `except`) was sent, by the connection's own account
 * (Gmail's SENT label), at or after `since` (milliseconds).
 */
export function sentSince(messages: readonly ThreadMessage[], since: number, except?: string) {
  return messages.some(
    (message) =>
      message.id !== except && message.labelIds.includes("SENT") && sentAt(message) >= since,
  );
}
