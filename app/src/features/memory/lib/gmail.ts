// Reading one Gmail message to learn from, through the Nango proxy. What it returns holds the
// message's text: in memory only, never stored, returned from a step or put in an error
// (invariant 8). Only its pointers, item key and the addresses on it are stored.
import { z } from "zod";
import { proxyGet } from "@/features/connections/server";
import type { Ctx } from "@/lib/ctx";
import type { SourceItem } from "./source-item";

const GMAIL = "/gmail/v1/users/me";

// How much of a body the models read: enough for a business email, short of a long thread's
// quoted history.
const MAX_BODY_CHARS = 12_000;

/** About the most text of one email a model reads: its body, and its headers. */
export const MAX_TEXT_CHARS = MAX_BODY_CHARS + 1_000;

type Part = {
  mimeType?: string | undefined;
  filename?: string | undefined;
  headers?: { name: string; value: string }[] | undefined;
  body?: { data?: string | undefined } | undefined;
  parts?: Part[] | undefined;
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

const messageSchema = z.object({
  id: z.string(),
  labelIds: z.array(z.string()).default([]),
  internalDate: z.string(),
  payload: partSchema.optional(),
});

/**
 * One email, read to learn from. Its item key is the Message-ID header, lowercased without its
 * angle brackets: the same in every copy. Its access list and `addresses` are everyone on it
 * (From, To, Cc, and Bcc as this copy shows it), `senders` its From, and `text` its headers and
 * body.
 */
export type EmailToLearn = SourceItem & { kind: "email"; labelIds: string[] };

const SHOWN_HEADERS = ["From", "To", "Cc", "Date", "Subject"];

/**
 * The message, or null when Gmail no longer has it or it's in the trash: deleting a message in
 * Gmail moves it there, and memory forgets what a deleted message taught.
 */
export async function readEmail(
  ctx: Ctx,
  connectionId: string,
  messageId: string,
): Promise<EmailToLearn | null> {
  const message = await proxyGet(
    ctx,
    connectionId,
    `${GMAIL}/messages/${encodeURIComponent(messageId)}?format=full`,
    messageSchema,
  );
  if (message === null || message.labelIds.includes("TRASH")) return null;
  const headers = message.payload?.headers ?? [];
  const header = (name: string) =>
    headers
      .filter((h) => h.name.toLowerCase() === name.toLowerCase())
      .map((h) => h.value)
      .join(", ");
  const messageIdHeader = header("Message-ID").trim();
  const shown = SHOWN_HEADERS.flatMap((name) => {
    const value = header(name);
    return value === "" ? [] : [`${name}: ${value}`];
  });
  const body = bodyText(flatten(message.payload)).slice(0, MAX_BODY_CHARS);
  const addresses = [
    ...new Set(["From", "To", "Cc", "Bcc"].flatMap((name) => addressesIn(header(name)))),
  ];
  return {
    kind: "email",
    sourceRef: message.id,
    // With no Message-ID, the copy is its own item: Gmail's message IDs are only unique within
    // one mailbox, and a shared item key makes a copy visible to its holder.
    itemKey:
      messageIdHeader === ""
        ? `gmail:${connectionId}:${message.id}`
        : messageIdHeader.replace(/^<|>$/g, "").toLowerCase(),
    occurredAt: new Date(Number(message.internalDate)),
    labelIds: message.labelIds,
    access: addresses.map((value) => ({ kind: "address", value })),
    addresses,
    senders: [...new Set(addressesIn(header("From")))],
    text: `${shown.join("\n")}\n\n${body}`,
  };
}

const ADDRESS = /[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;

/** The email addresses in `text`, lowercased. */
export function addressesIn(text: string): string[] {
  return Array.from(text.matchAll(ADDRESS), (match) => match[0].toLowerCase());
}

function flatten(part: Part | undefined): Part[] {
  if (part === undefined) return [];
  return [part, ...(part.parts ?? []).flatMap(flatten)];
}

// Its text/plain parts, or failing those its text/html parts stripped of tags.
function bodyText(parts: Part[]): string {
  const inline = parts.filter(
    (part) => (part.filename ?? "") === "" && part.body?.data !== undefined,
  );
  const plain = inline.filter((part) => part.mimeType === "text/plain");
  if (plain.length > 0) return plain.map(decode).join("\n");
  return inline
    .filter((part) => part.mimeType === "text/html")
    .map((part) =>
      decode(part)
        .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&"),
    )
    .join("\n");
}

function decode(part: Part): string {
  return Buffer.from(part.body?.data ?? "", "base64url").toString("utf8");
}
