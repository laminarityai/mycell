// Gmail's API as Mycel reads it through the Nango proxy: its path, the shapes of its answers
// (parsed with Zod), reading a message's headers and text, and where a thread opens in Gmail's
// web app. Pure: no IO. Discovery, memory
// and runtime each fetch through their own calls, and read what they fetched with these, so
// they all read a message the same way. A message's text is read in memory only: never stored
// (invariant 8).
import { z } from "zod";

/** Where every Gmail API path for the connection's own mailbox starts. */
export const GMAIL = "/gmail/v1/users/me";

export type Header = { name: string; value: string };

export const headerSchema = z.object({ name: z.string(), value: z.string() });

/** A MIME part of a message: the payload is one, and multipart parts nest more. */
export type MessagePart = {
  mimeType?: string | undefined;
  filename?: string | undefined;
  headers?: Header[] | undefined;
  body?: { size?: number | undefined; data?: string | undefined } | undefined;
  parts?: MessagePart[] | undefined;
};

export const messagePartSchema: z.ZodType<MessagePart> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(headerSchema).optional(),
    body: z.object({ size: z.number().optional(), data: z.string().optional() }).optional(),
    parts: z.array(messagePartSchema).optional(),
  }),
);

/**
 * A message as users.messages.get answers: `format=full` has the whole payload, `metadata` only
 * the headers asked for, and `minimal` none. A reader picks the fields it reads.
 */
export const messageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).default([]),
  // Milliseconds since the epoch, as a string: when Gmail received or sent it.
  internalDate: z.string(),
  payload: messagePartSchema.optional(),
});
export type Message = z.infer<typeof messageSchema>;

/** A thread as users.threads.get answers, each of its messages read with `message`. */
export function threadSchema<T extends z.ZodType>(message: T) {
  return z.object({ id: z.string(), messages: z.array(message).default([]) });
}

/** A page of users.messages.list: message and thread IDs only. */
export const messageListSchema = z.object({
  messages: z.array(z.object({ id: z.string(), threadId: z.string() })).default([]),
  nextPageToken: z.string().optional(),
});

export const labelSchema = z.object({ id: z.string(), name: z.string() });
export type Label = z.infer<typeof labelSchema>;

/** users.labels.list: every label in the mailbox. */
export const labelsSchema = z.object({ labels: z.array(labelSchema).default([]) });

/**
 * A thread in Gmail's web app, opened in the account it's in: a review's message, or the one a
 * run started from. `authuser` picks the account when the person is signed in to several.
 */
export function gmailLink(accountEmail: string, threadId: string): string {
  const account = encodeURIComponent(accountEmail);
  return `https://mail.google.com/mail/?authuser=${account}#all/${encodeURIComponent(threadId)}`;
}

/** The label named `name`. Gmail's label names are unique regardless of case. */
export function labelNamed(labels: readonly Label[], name: string): Label | undefined {
  return labels.find((label) => label.name.toLowerCase() === name.toLowerCase());
}

/** Every value of the header `name`, in order. Header names are matched regardless of case. */
export function headerValues(headers: readonly Header[] | undefined, name: string): string[] {
  return (headers ?? [])
    .filter((header) => header.name.toLowerCase() === name.toLowerCase())
    .map((header) => header.value);
}

/** The first value of the header `name`, regardless of case; undefined when it has none. */
export function headerValue(
  headers: readonly Header[] | undefined,
  name: string,
): string | undefined {
  return headerValues(headers, name).at(0);
}

/** Every part of a message, depth first, the payload included. */
export function flattenParts(part: MessagePart | undefined): MessagePart[] {
  if (part === undefined) return [];
  return [part, ...(part.parts ?? []).flatMap(flattenParts)];
}

/** Whether the part is an attached file: it has a file name. */
export function isAttachment(part: MessagePart): boolean {
  return (part.filename ?? "") !== "";
}

/**
 * A message's body: its text/plain parts, or failing those its text/html parts as text, with
 * the link targets those held (`links`, which carry Drive file IDs and mailto addresses).
 * Attached files are no part of it.
 */
export function messageBody(payload: MessagePart | undefined): { text: string; links: string[] } {
  const inline = flattenParts(payload).filter(
    (part) => !isAttachment(part) && part.body?.data !== undefined,
  );
  const plain = inline.filter((part) => part.mimeType === "text/plain");
  if (plain.length > 0) return { text: plain.map(decodePart).join("\n"), links: [] };
  const html = inline.filter((part) => part.mimeType === "text/html").map(decodePart);
  return { text: html.map(htmlToText).join("\n"), links: html.flatMap(linksIn) };
}

/**
 * HTML as text: scripts and styles dropped, tags turned to spaces, runs of white space made one
 * space, and character references decoded.
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return decodeEntities(text);
}

// Where the HTML's links go, character references decoded.
function linksIn(html: string): string[] {
  return Array.from(html.matchAll(/href\s*=\s*["']([^"']*)["']/gi), ([, href]) =>
    decodeEntities(href),
  );
}

function decodePart(part: MessagePart): string {
  return Buffer.from(part.body?.data ?? "", "base64url").toString("utf8");
}

// The named references mail uses most, and numeric ones (decimal and hex). `&amp;` goes last,
// so `&amp;lt;` reads as `&lt;`, as written.
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => character(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => character(parseInt(code, 16)))
    .replace(/&(lt|gt|quot|apos|nbsp);/g, (_, name: string) => ENTITIES[name] ?? " ")
    .replace(/&amp;/g, "&");
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

// A character code anyone can write into an email, so one no character has (past U+10FFFF)
// reads as U+FFFD, the replacement character, rather than throwing and failing whatever reads
// the message on every retry.
function character(code: number): string {
  return code <= 0x10ffff ? String.fromCodePoint(code) : "�";
}
