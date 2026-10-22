// Gmail through the Nango proxy, for runs. Content is fetched inside the step that uses it and
// held in memory, or handed to later steps in the step state, which Inngest stores encrypted
// (ADR-0021); never in our database (invariant 8).
import { z } from "zod";
import { proxyGet } from "@/features/connections/server";
import type { Ctx } from "@/lib/ctx";
import { RunStepError } from "./failures";

export const GMAIL = "/gmail/v1/users/me";

type Part = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: Part[];
};
const partSchema: z.ZodType<Part> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
    body: z.object({ data: z.string().optional() }).optional(),
    parts: z.array(partSchema).optional(),
  }),
);

export const messageRefSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).default([]),
});
export const fullMessageSchema = messageRefSchema.extend({ payload: partSchema.optional() });
type FullMessage = z.infer<typeof fullMessageSchema>;
const threadSchema = z.object({ id: z.string(), messages: z.array(messageRefSchema).default([]) });
const fullThreadSchema = z.object({ messages: z.array(fullMessageSchema).default([]) });

async function get<T>(ctx: Ctx, connectionId: string, path: string, schema: z.ZodType<T>) {
  const found = await proxyGet(ctx, connectionId, path, schema);
  if (found === null) throw new RunStepError("source_item_missing", "Gmail has no such item.");
  return found;
}

/** The message's IDs and labels, without its headers or body. */
export async function messageRef(ctx: Ctx, connectionId: string, messageId: string) {
  return get(
    ctx,
    connectionId,
    `${GMAIL}/messages/${encodeURIComponent(messageId)}?format=minimal`,
    messageRefSchema,
  );
}

/**
 * The message's IDs and labels, with its sender, subject and plain-text body: what the
 * read-message action hands to later steps. Never into a run record or an error.
 */
export async function messageWithText(ctx: Ctx, connectionId: string, messageId: string) {
  const message = await get(
    ctx,
    connectionId,
    `${GMAIL}/messages/${encodeURIComponent(messageId)}?format=full`,
    fullMessageSchema,
  );
  const { from, subject, body } = fieldsOf(message);
  return {
    id: message.id,
    threadId: message.threadId,
    labelIds: message.labelIds,
    from,
    subject,
    body,
  };
}

/** The thread's ID and its messages' IDs. */
export async function threadRef(ctx: Ctx, connectionId: string, threadId: string) {
  return get(
    ctx,
    connectionId,
    `${GMAIL}/threads/${encodeURIComponent(threadId)}?format=minimal`,
    threadSchema,
  );
}

/**
 * The message as text a model reads: sender, subject and plain-text body. In memory only:
 * never return it from a step or put it in an error.
 */
export async function messageText(ctx: Ctx, connectionId: string, messageId: string) {
  const message = await get(
    ctx,
    connectionId,
    `${GMAIL}/messages/${encodeURIComponent(messageId)}?format=full`,
    fullMessageSchema,
  );
  return asText(message);
}

/**
 * The facts the Gmail trigger declares (`spec/triggers.ts`), read from the message: its
 * sender's address and domain, its subject, whether it has an attachment, and whether it
 * replies to another message. In memory only: never return them from a step or put them in an
 * error.
 */
export async function messageFacts(ctx: Ctx, connectionId: string, messageId: string) {
  const message = await get(
    ctx,
    connectionId,
    `${GMAIL}/messages/${encodeURIComponent(messageId)}?format=full`,
    fullMessageSchema,
  );
  const { from, subject } = fieldsOf(message);
  // "Ada Lovelace <ada@customer.test>", or the bare address.
  const sender = (/<([^>]*)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
  const headers = message.payload?.headers ?? [];
  const has = (name: string) => headers.some((h) => h.name.toLowerCase() === name.toLowerCase());
  return {
    sender,
    senderDomain: sender.includes("@") ? (sender.split("@").at(-1) ?? "") : "",
    subject,
    hasAttachment: hasAttachment(message.payload),
    isReply: has("In-Reply-To") || has("References"),
  };
}

function hasAttachment(part: Part | undefined): boolean {
  if (part === undefined) return false;
  if (part.filename !== undefined && part.filename !== "") return true;
  return (part.parts ?? []).some(hasAttachment);
}

/** The thread's messages as text, oldest first, leaving out drafts. In memory only, too. */
export async function threadText(ctx: Ctx, connectionId: string, threadId: string) {
  const thread = await get(
    ctx,
    connectionId,
    `${GMAIL}/threads/${encodeURIComponent(threadId)}?format=full`,
    fullThreadSchema,
  );
  return thread.messages
    .filter((message) => !message.labelIds.includes("DRAFT"))
    .map(asText)
    .join("\n\n---\n\n");
}

const searchSchema = z.object({
  messages: z.array(z.object({ id: z.string(), threadId: z.string() })).default([]),
});

/** The IDs of the newest messages matching a Gmail search, at most `limit` of them. */
export async function searchMessages(
  ctx: Ctx,
  connectionId: string,
  query: string,
  limit: number,
): Promise<{ id: string; threadId: string }[]> {
  const params = new URLSearchParams({ q: query, maxResults: String(limit) });
  const found = await proxyGet(ctx, connectionId, `${GMAIL}/messages?${params}`, searchSchema);
  return found?.messages ?? [];
}

/** A message's sender, date, subject and plain-text body. */
type MessageFields = { from: string; date: string; subject: string; body: string };

/**
 * The message's fields, or null when Gmail has no such message. In memory only, like
 * messageText: never store them.
 */
export async function readMessage(
  ctx: Ctx,
  connectionId: string,
  messageId: string,
): Promise<MessageFields | null> {
  const message = await proxyGet(
    ctx,
    connectionId,
    `${GMAIL}/messages/${encodeURIComponent(messageId)}?format=full`,
    fullMessageSchema,
  );
  return message === null ? null : fieldsOf(message);
}

/**
 * A message's sender, recipients, subject, date and plain-text body, as the Reviews page shows
 * it. In memory only: never store it.
 */
export function mailOf(message: FullMessage) {
  const { from, date, subject, body } = fieldsOf(message);
  const to = (message.payload?.headers ?? []).find((h) => h.name.toLowerCase() === "to");
  return { from, to: to?.value ?? "", subject, date, text: body };
}

function asText(message: FullMessage): string {
  const { from, subject, body } = fieldsOf(message);
  return `From: ${from}\nSubject: ${subject}\n\n${body}`;
}

function fieldsOf(message: FullMessage): MessageFields {
  const headers = message.payload?.headers ?? [];
  const header = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
  const body =
    textOf(message.payload, "text/plain") ?? stripTags(textOf(message.payload, "text/html") ?? "");
  return { from: header("From"), date: header("Date"), subject: header("Subject"), body };
}

function textOf(part: Part | undefined, mimeType: string): string | undefined {
  if (part === undefined) return undefined;
  if (part.mimeType === mimeType && part.body?.data !== undefined) {
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  }
  for (const child of part.parts ?? []) {
    const text = textOf(child, mimeType);
    if (text !== undefined) return text;
  }
  return undefined;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
