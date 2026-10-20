// The create-draft action: a reply to a message, in its thread, addressed to its sender, with
// In-Reply-To and References so Gmail shows it as a reply. Each draft carries a marker header
// naming the run and step that made it, and the action looks for that draft before writing, so
// a retry whose first answer was lost leaves one draft and generates no second text.
import { z } from "zod";
import { proxyGet, proxyPost } from "@/features/connections/server";
import type { Ctx } from "@/lib/ctx";
import { RunStepError } from "./failures";
import { GMAIL } from "./gmail";

/** The header that marks a draft as one run step's. */
export const DRAFT_MARKER_HEADER = "X-Mycel-Draft";

/**
 * What the action takes. `compose` generates the reply's text; it's called only when the step
 * hasn't made its draft yet, and its text is held in memory only (invariant 8).
 */
export type DraftInput = { messageId: string; marker: string; compose: () => Promise<string> };

const REPLY_HEADERS = ["From", "Reply-To", "Subject", "Message-ID", "References"];

const headersSchema = z.array(z.object({ name: z.string(), value: z.string() })).default([]);
const metadataSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).default([]),
  payload: z.object({ headers: headersSchema }).default({ headers: [] }),
});
const threadSchema = z.object({ messages: z.array(metadataSchema).default([]) });
const draftsPage = z.object({
  drafts: z.array(z.object({ id: z.string(), message: z.object({ id: z.string() }) })).default([]),
  nextPageToken: z.string().optional(),
});
const createdDraft = z.object({ id: z.string(), message: z.object({ threadId: z.string() }) });

/** Makes the reply draft, or finds the one this step made on an earlier try. */
export async function createReplyDraft(
  ctx: Ctx,
  connectionId: string,
  input: DraftInput,
): Promise<{ draftId: string; threadId: string }> {
  const query = new URLSearchParams({ format: "metadata" });
  for (const name of REPLY_HEADERS) query.append("metadataHeaders", name);
  const original = await found(
    proxyGet(
      ctx,
      connectionId,
      `${GMAIL}/messages/${encodeURIComponent(input.messageId)}?${query.toString()}`,
      metadataSchema,
    ),
  );
  const earlier = await findMarkedDraft(ctx, connectionId, original.threadId, input.marker);
  if (earlier !== undefined) return { draftId: earlier, threadId: original.threadId };

  const raw = replyMessage(original.payload.headers, await input.compose(), input.marker);
  const draft = await found(
    proxyPost(
      ctx,
      connectionId,
      `${GMAIL}/drafts`,
      { message: { raw, threadId: original.threadId } },
      createdDraft,
    ),
  );
  return { draftId: draft.id, threadId: draft.message.threadId };
}

// The draft in the thread carrying the marker, by its draft ID. The thread names its drafts'
// messages and their headers; drafts.list maps a message to its draft, but carries no headers.
async function findMarkedDraft(ctx: Ctx, connectionId: string, threadId: string, marker: string) {
  const query = new URLSearchParams({ format: "metadata", metadataHeaders: DRAFT_MARKER_HEADER });
  const thread = await found(
    proxyGet(
      ctx,
      connectionId,
      `${GMAIL}/threads/${encodeURIComponent(threadId)}?${query.toString()}`,
      threadSchema,
    ),
  );
  const marked = thread.messages.find(
    (message) =>
      message.labelIds.includes("DRAFT") &&
      headerOf(message.payload.headers, DRAFT_MARKER_HEADER) === marker,
  );
  if (marked === undefined) return undefined;
  let pageToken: string | undefined;
  do {
    const page = new URLSearchParams({ maxResults: "500" });
    if (pageToken !== undefined) page.set("pageToken", pageToken);
    const drafts = await found(
      proxyGet(ctx, connectionId, `${GMAIL}/drafts?${page.toString()}`, draftsPage),
    );
    const draft = drafts.drafts.find((d) => d.message.id === marked.id);
    if (draft !== undefined) return draft.id;
    pageToken = drafts.nextPageToken;
  } while (pageToken !== undefined);
  return undefined;
}

type Header = { name: string; value: string };

/** The reply as RFC 2822, base64url-encoded as drafts.create takes it. */
function replyMessage(original: Header[], text: string, marker: string): string {
  const header = (name: string) => oneLine(headerOf(original, name) ?? "");
  const messageId = header("Message-ID");
  const subject = header("Subject");
  const references = [header("References"), messageId].filter((part) => part !== "").join(" ");
  const lines = [
    `To: ${header("Reply-To") || header("From")}`,
    `Subject: ${encodeWord(/^re:/i.test(subject) ? subject : `Re: ${subject}`)}`,
    ...(messageId === "" ? [] : [`In-Reply-To: ${messageId}`, `References: ${references}`]),
    `${DRAFT_MARKER_HEADER}: ${marker}`,
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

function headerOf(headers: Header[], name: string): string | undefined {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
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
