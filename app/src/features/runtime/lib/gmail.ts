// Gmail through the Nango proxy, for runs. Content is fetched inside the step that uses it and
// held in memory only (invariant 8); what leaves here for a step's output is IDs and counts.
import { z } from "zod";
import { proxyGet } from "@/features/connections/server";
import type { Ctx } from "@/lib/ctx";
import { RunStepError } from "./failures";

const GMAIL = "/gmail/v1/users/me";

type Part = {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: Part[];
};
const partSchema: z.ZodType<Part> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    headers: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
    body: z.object({ data: z.string().optional() }).optional(),
    parts: z.array(partSchema).optional(),
  }),
);

const messageRefSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).default([]),
});
const fullMessageSchema = messageRefSchema.extend({ payload: partSchema.optional() });
const threadSchema = z.object({ id: z.string(), messages: z.array(messageRefSchema).default([]) });

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
  const headers = message.payload?.headers ?? [];
  const header = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
  const body =
    textOf(message.payload, "text/plain") ?? stripTags(textOf(message.payload, "text/html") ?? "");
  return `From: ${header("From")}\nSubject: ${header("Subject")}\n\n${body}`;
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
