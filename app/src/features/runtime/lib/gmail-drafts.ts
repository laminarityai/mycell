// The create-draft action: a reply to a message, in its thread, addressed to its sender, with
// In-Reply-To and References so Gmail shows it as a reply. Each draft carries a marker header
// naming the run and step that made it, and the action looks for that draft before writing, so
// a retry whose first answer was lost leaves one draft and generates no second text.
import { z } from "zod";
import {
  GMAIL,
  headerValue,
  messageSchema,
  threadSchema,
  type Header,
} from "@/features/connections/gmail";
import { sourceClient } from "@/features/connections/server";
import type { SourceClient } from "@/features/connections/types";
import type { Ctx } from "@/lib/ctx";
import { RunStepError } from "./failures";
import type { Compose } from "./step-context";

/** The header that marks a draft as one run step's. */
export const DRAFT_MARKER_HEADER = "X-Mycel-Draft";

const REPLY_HEADERS = ["From", "Reply-To", "Subject", "Message-ID", "References"];

// A message as format=metadata gives it: its IDs, labels and the headers asked for.
const metadataSchema = messageSchema.pick({
  id: true,
  threadId: true,
  labelIds: true,
  payload: true,
});
const metadataThreadSchema = threadSchema(metadataSchema);
const draftsPage = z.object({
  drafts: z.array(z.object({ id: z.string(), message: z.object({ id: z.string() }) })).default([]),
  nextPageToken: z.string().optional(),
});
const createdDraft = z.object({ id: z.string(), message: z.object({ threadId: z.string() }) });

/**
 * Makes the reply draft to `input.messageId`, or finds the one this step (`marker`) made on an
 * earlier try. `compose` generates the reply's text; it's called only when there's no draft
 * yet. Only a draft step gives one: a tool step can't make a draft (the policy refuses it).
 */
export async function createReplyDraft(
  ctx: Ctx,
  connectionId: string,
  input: { messageId: string },
  marker: string,
  compose?: Compose,
): Promise<{ draftId: string; threadId: string }> {
  if (compose === undefined) {
    throw new RunStepError("not_available", "Only a draft step can make a draft.");
  }
  // Several calls, one connection read.
  const source = await sourceClient(ctx, connectionId);
  const original = await originalOf(source, input.messageId);
  const earlier = await findMarkedDraft(source, original.threadId, marker);
  if (earlier !== undefined) return { draftId: earlier, threadId: original.threadId };

  const raw = replyMessage(original.payload?.headers ?? [], await compose(), marker);
  const draft = await found(
    source.post(`${GMAIL}/drafts`, { message: { raw, threadId: original.threadId } }, createdDraft),
  );
  return { draftId: draft.id, threadId: draft.message.threadId };
}

/**
 * Who a reply to `messageId` would go to, under which subject, in which thread: what a dry run
 * shows instead of making the draft. Reads only.
 */
export async function replyTarget(
  ctx: Ctx,
  connectionId: string,
  messageId: string,
): Promise<{ threadId: string; to: string; subject: string }> {
  const original = await originalOf(await sourceClient(ctx, connectionId), messageId);
  return { threadId: original.threadId, ...addressOf(original.payload?.headers ?? []) };
}

async function originalOf(source: SourceClient, messageId: string) {
  const query = new URLSearchParams({ format: "metadata" });
  for (const name of REPLY_HEADERS) query.append("metadataHeaders", name);
  return found(
    source.get(
      `${GMAIL}/messages/${encodeURIComponent(messageId)}?${query.toString()}`,
      metadataSchema,
    ),
  );
}

/** A reply's recipient and subject, from the original's headers. */
function addressOf(original: Header[]): { to: string; subject: string } {
  const header = (name: string) => oneLine(headerValue(original, name) ?? "");
  const subject = header("Subject");
  return {
    to: header("Reply-To") || header("From"),
    subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
  };
}

// The draft in the thread carrying the marker, by its draft ID. The thread names its drafts'
// messages and their headers; drafts.list maps a message to its draft, but carries no headers.
async function findMarkedDraft(source: SourceClient, threadId: string, marker: string) {
  const query = new URLSearchParams({ format: "metadata", metadataHeaders: DRAFT_MARKER_HEADER });
  const thread = await found(
    source.get(
      `${GMAIL}/threads/${encodeURIComponent(threadId)}?${query.toString()}`,
      metadataThreadSchema,
    ),
  );
  const marked = thread.messages.find(
    (message) =>
      message.labelIds.includes("DRAFT") &&
      headerValue(message.payload?.headers, DRAFT_MARKER_HEADER) === marker,
  );
  if (marked === undefined) return undefined;
  let pageToken: string | undefined;
  do {
    const page = new URLSearchParams({ maxResults: "500" });
    if (pageToken !== undefined) page.set("pageToken", pageToken);
    const drafts = await found(source.get(`${GMAIL}/drafts?${page.toString()}`, draftsPage));
    const draft = drafts.drafts.find((d) => d.message.id === marked.id);
    if (draft !== undefined) return draft.id;
    pageToken = drafts.nextPageToken;
  } while (pageToken !== undefined);
  return undefined;
}

/** The reply as RFC 2822, base64url-encoded as drafts.create takes it. */
function replyMessage(original: Header[], text: string, marker: string): string {
  const header = (name: string) => oneLine(headerValue(original, name) ?? "");
  const messageId = header("Message-ID");
  const { to, subject } = addressOf(original);
  const references = [header("References"), messageId].filter((part) => part !== "").join(" ");
  const headers: Header[] = [
    { name: "To", value: to },
    { name: "Subject", value: subject },
    ...(messageId === ""
      ? []
      : [
          { name: "In-Reply-To", value: messageId },
          { name: "References", value: references },
        ]),
    { name: DRAFT_MARKER_HEADER, value: marker },
  ];
  return rawMessage(headers, text);
}

/** The headers a draft keeps when its text is replaced: who it goes to, and what it replies to. */
const KEPT_HEADERS = ["To", "Cc", "Subject", "In-Reply-To", "References", DRAFT_MARKER_HEADER];

/**
 * The draft with `headers` (its own, as Gmail returns them) and new text, as RFC 2822 for
 * drafts.update: it keeps its recipients, subject, place in the thread and marker.
 */
export function editedMessage(headers: Header[], text: string): string {
  const kept = KEPT_HEADERS.flatMap((name) => {
    const value = headerValue(headers, name);
    return value === undefined ? [] : [{ name, value: oneLine(value) }];
  });
  return rawMessage(kept, text);
}

/** A plain-text message with `headers`, base64url-encoded as Gmail's drafts take it. */
function rawMessage(headers: Header[], text: string): string {
  const lines = [
    ...headers.map(
      ({ name, value }) => `${name}: ${name === "Subject" ? encodeWord(value) : value}`,
    ),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    (
      Buffer.from(text, "utf8")
        .toString("base64")
        .match(/.{1,76}/g) ?? []
    ).join("\r\n"),
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

// A header value from the original can't break out onto a line of its own.
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

// RFC 2047: a value with anything but printable ASCII goes as one UTF-8 encoded word.
function encodeWord(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

async function found<T>(request: Promise<T | null>): Promise<T> {
  const result = await request;
  if (result === null) throw new RunStepError("source_item_missing", "Gmail has no such item.");
  return result;
}
